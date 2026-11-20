// Central do Mercado Frete: um Durable Object com banco SQLite.
// Guarda clientes, motoristas, corridas, ofertas, chat e localização, com consistência forte
// (um pedido por vez), o que evita dois motoristas aceitarem a mesma corrida.
//
// Fluxo da corrida:
//   buscando ──(motorista aceita)──▶ aceito ──(Cheguei ao mercado)──▶ aguardando_pagamento
//   ──(cliente paga)──▶ pago ──(Entregue)──▶ entregue
//   e, a qualquer momento antes do pagamento, cancelado. Se o motorista já chegou ao mercado e o
//   cliente cancela ou não paga no prazo, o cliente fica com a taxa de deslocamento pendente,
//   cobrada junto do próximo frete.

import { DurableObject } from 'cloudflare:workers';
import { MERCADOS } from '../../src/data/mercados';
import { TARIFAS_PADRAO } from '../../src/data/tarifas';
import {
  AGENDA_PADRAO,
  dataLocal,
  dentroDoHorario,
  horaLocal,
  horarioValido,
  proximosDias,
  rotuloDia,
  sobrepoeBloco,
  type Bloco,
  type ConfigAgenda,
} from '../../src/services/agenda';
import { cpfValido } from '../../src/services/cpf';
import { distanciaRetaKm, estimarIdaEVolta, precoFrete, precoSugerido, URGENCIA_PADRAO, type Tarifa, type Urgencia } from '../../src/services/preco';
import { rotasAteCasa } from '../../src/services/grafo';

export interface Env {
  CENTRAL: DurableObjectNamespace;
  DOCS?: R2Bucket;
  INFINITEPAY_HANDLE: string;
  INFINITEPAY_API_KEY?: string;
  ADMIN_TOKEN: string;
  APP_SCHEME: string;
  WHATSAPP_PHONE?: string;
  CALLMEBOT_APIKEY?: string;
}

export type Config = ConfigAgenda & {
  tarifas: Tarifa[];
  margem: number;
  urgencia: Urgencia;
  comissaoMotoristaPct: number; // parte do frete que fica com o motorista (80)
  taxaDeslocamento: number; // R$ cobrados se o cliente cancelar ou não pagar com o motorista no mercado
  esperaPagamentoMin: number; // quanto o motorista espera o pagamento no mercado
  ofertaMin: number; // quanto tempo uma corrida "agora" procura motorista
};

export const CONFIG_PADRAO: Config = {
  ...AGENDA_PADRAO,
  tarifas: TARIFAS_PADRAO,
  margem: 0,
  urgencia: URGENCIA_PADRAO,
  comissaoMotoristaPct: 80,
  taxaDeslocamento: 5,
  esperaPagamentoMin: 15,
  ofertaMin: 5,
};

const MIN = 60_000;
const ATIVAS = `('buscando','aceito','aguardando_pagamento','pago')`;
const LOC_VALIDA_MIN = 3; // motorista online sem enviar posição há mais que isso não recebe "agora"
const API_IP = 'https://api.checkout.infinitepay.io';

type Linha = Record<string, string | number | null>;
type Quem = { tipo: 'cliente' | 'motorista' | 'admin'; id: string; linha?: Linha };

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, authorization',
  'access-control-allow-methods': 'GET,POST,PUT,DELETE',
};
export const json = (d: unknown, status = 200) =>
  new Response(JSON.stringify(d), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...CORS } });
export const erro = (mensagem: string, status = 400) => json({ erro: mensagem }, status);
const brl = (v: number) => 'R$ ' + v.toFixed(2).replace('.', ',');
const iso = (ms: number) => new Date(ms).toISOString();
const r2 = (v: number) => Math.round(v * 100) / 100;
const novoId = (p: string) => `${p}-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 6)}`;
const soDigitos = (s: unknown) => String(s ?? '').replace(/\D/g, '');

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS config (chave TEXT PRIMARY KEY, valor TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS clientes (
  id TEXT PRIMARY KEY, token TEXT UNIQUE NOT NULL, nome TEXT NOT NULL, cpf TEXT NOT NULL, telefone TEXT,
  foto TEXT, endereco TEXT NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL, taxa_pendente REAL NOT NULL DEFAULT 0,
  bloqueado INTEGER NOT NULL DEFAULT 0, criado_em TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS motoristas (
  id TEXT PRIMARY KEY, token TEXT UNIQUE NOT NULL, nome TEXT NOT NULL, cpf TEXT NOT NULL, telefone TEXT NOT NULL,
  carro TEXT NOT NULL, placa TEXT NOT NULL, cor TEXT, selfie TEXT, cnh TEXT, pix TEXT,
  status TEXT NOT NULL DEFAULT 'pendente', online INTEGER NOT NULL DEFAULT 0, lat REAL, lon REAL, loc_em TEXT,
  criado_em TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS corridas (
  id TEXT PRIMARY KEY, cliente_id TEXT NOT NULL, motorista_id TEXT, mercado_id TEXT NOT NULL, mercado_nome TEXT NOT NULL,
  agendado INTEGER NOT NULL, inicio TEXT NOT NULL, fim TEXT NOT NULL, janela TEXT NOT NULL, status TEXT NOT NULL,
  valor REAL NOT NULL, km REAL NOT NULL, minutos REAL NOT NULL, taxa_incluida REAL NOT NULL DEFAULT 0, valor_cobrado REAL,
  ganho_motorista REAL, repassado INTEGER NOT NULL DEFAULT 0, checkout_url TEXT, slug TEXT, transaction_nsu TEXT,
  metodo TEXT, receipt_url TEXT, motivo TEXT, cancelado_por TEXT, taxa_aplicada REAL NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL, oferta_ate TEXT, aceito_em TEXT, chegou_em TEXT, pago_em TEXT, entregue_em TEXT, cancelado_em TEXT);
CREATE INDEX IF NOT EXISTS corridas_status ON corridas(status);
CREATE TABLE IF NOT EXISTS recusas (corrida_id TEXT NOT NULL, motorista_id TEXT NOT NULL, PRIMARY KEY (corrida_id, motorista_id));
CREATE TABLE IF NOT EXISTS mensagens (
  id INTEGER PRIMARY KEY AUTOINCREMENT, corrida_id TEXT NOT NULL, autor TEXT NOT NULL, texto TEXT NOT NULL, criado_em TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS repasses (
  id TEXT PRIMARY KEY, motorista_id TEXT NOT NULL, valor REAL NOT NULL, corridas INTEGER NOT NULL, criado_em TEXT NOT NULL);
`;

export class Central extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      for (const cmd of ESQUEMA.split(';').map((c) => c.trim()).filter(Boolean)) this.sql.exec(cmd);
    });
  }

  // ---------- utilidades de banco ----------
  private q<T extends Linha = Linha>(consulta: string, ...args: unknown[]): T[] {
    return this.sql.exec(consulta, ...args).toArray() as unknown as T[];
  }
  private um<T extends Linha = Linha>(consulta: string, ...args: unknown[]): T | undefined {
    return this.q<T>(consulta, ...args)[0];
  }

  config(): Config {
    const l = this.um<{ valor: string }>(`SELECT valor FROM config WHERE chave='geral'`);
    return { ...CONFIG_PADRAO, ...(l ? JSON.parse(l.valor) : {}) };
  }
  private salvarConfig(c: Config) {
    this.sql.exec(`INSERT INTO config (chave, valor) VALUES ('geral', ?) ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor`, JSON.stringify(c));
  }

  // ---------- avisos no WhatsApp do dono ----------
  private async whatsapp(texto: string): Promise<boolean> {
    const { WHATSAPP_PHONE: tel, CALLMEBOT_APIKEY: chave } = this.env;
    if (!tel || !chave) return false;
    const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(tel)}&text=${encodeURIComponent(texto)}&apikey=${encodeURIComponent(chave)}`;
    const r = await fetch(url).catch(() => null);
    return !!r && r.ok;
  }
  private avisar(texto: string) {
    this.ctx.waitUntil(this.whatsapp(texto));
  }
  private textoCorrida(c: Linha, cab: string) {
    const cli = this.um(`SELECT nome, telefone, endereco, lat, lon FROM clientes WHERE id=?`, c.cliente_id);
    const mot = c.motorista_id ? this.um(`SELECT nome, placa FROM motoristas WHERE id=?`, c.motorista_id) : undefined;
    return [
      cab,
      `Quando: ${c.agendado ? c.janela : `AGORA (${horaLocal(Date.parse(String(c.criado_em)))})`}`,
      `Cliente: ${cli?.nome ?? '-'}${cli?.telefone ? ` · ${cli.telefone}` : ''}`,
      `Mercado: ${c.mercado_nome}`,
      `Entregar em: ${cli?.endereco ?? '-'}`,
      cli ? `Mapa: https://www.google.com/maps/search/?api=1&query=${cli.lat},${cli.lon}` : '',
      `Frete: ${brl(Number(c.valor))}`,
      mot ? `Motorista: ${mot.nome} (${mot.placa})` : 'Motorista: procurando…',
    ]
      .filter(Boolean)
      .join('\n');
  }

  // ---------- manutenção (roda a cada requisição) ----------
  private manutencao() {
    const agora = Date.now();
    const cfg = this.config();
    // "Agora" sem motorista no prazo → cancelada.
    for (const c of this.q(`SELECT * FROM corridas WHERE status='buscando' AND oferta_ate < ?`, iso(agora))) {
      this.sql.exec(`UPDATE corridas SET status='cancelado', motivo='sem_motorista', cancelado_por='sistema', cancelado_em=? WHERE id=?`, iso(agora), c.id);
      this.avisar(this.textoCorrida(c, '⚠️ CORRIDA SEM MOTORISTA — cancelada automaticamente'));
    }
    // Motorista no mercado e cliente não pagou no prazo → cancela com taxa de deslocamento.
    for (const c of this.q(`SELECT * FROM corridas WHERE status='aguardando_pagamento' AND chegou_em < ?`, iso(agora - cfg.esperaPagamentoMin * MIN)))
      this.cancelarComTaxa(c, 'nao_pagou', 'sistema');
    // Motorista sem enviar posição → offline.
    this.sql.exec(`UPDATE motoristas SET online=0 WHERE online=1 AND (loc_em IS NULL OR loc_em < ?)`, iso(agora - 30 * MIN));
  }

  private cancelarComTaxa(c: Linha, motivo: string, por: string) {
    const cfg = this.config();
    const agora = iso(Date.now());
    this.sql.exec(
      `UPDATE corridas SET status='cancelado', motivo=?, cancelado_por=?, cancelado_em=?, taxa_aplicada=?, fim=? WHERE id=?`,
      motivo, por, agora, cfg.taxaDeslocamento, agora, c.id,
    );
    this.sql.exec(`UPDATE clientes SET taxa_pendente = taxa_pendente + ? WHERE id=?`, cfg.taxaDeslocamento, c.cliente_id);
    this.avisar(this.textoCorrida(c, `❌ CANCELADA com motorista no mercado (${motivo === 'nao_pagou' ? 'cliente não pagou' : 'cliente cancelou'}) — taxa de ${brl(cfg.taxaDeslocamento)} na próxima corrida`));
  }

  // ---------- agenda ----------
  private blocosAtivos(agora: number): Bloco[] {
    return this.q<{ inicio: string; fim: string }>(`SELECT inicio, fim FROM corridas WHERE status IN ${ATIVAS} OR (status='entregue' AND fim > ?)`, iso(agora))
      .map((b) => ({ inicio: Date.parse(b.inicio), fim: Date.parse(b.fim) }))
      .filter((b) => b.fim > agora);
  }
  private aprovados(): number {
    return Number(this.um(`SELECT COUNT(*) AS n FROM motoristas WHERE status='aprovado'`)?.n ?? 0);
  }
  private livreDoMotorista(motoristaId: unknown, bloco: Bloco, ignorar?: unknown): boolean {
    return !this.q<{ inicio: string; fim: string; id: string }>(
      `SELECT id, inicio, fim FROM corridas WHERE motorista_id=? AND (status IN ${ATIVAS} OR status='entregue')`,
      motoristaId,
    ).some((c) => c.id !== ignorar && sobrepoeBloco({ inicio: Date.parse(c.inicio), fim: Date.parse(c.fim) }, bloco));
  }
  /** Motoristas online, aprovados, com posição recente e sem corrida no intervalo. */
  private motoristasLivresAgora(agora: number): Linha[] {
    const cfg = this.config();
    const bloco = { inicio: agora, fim: agora + cfg.bloqueioMin * MIN };
    return this.q(`SELECT * FROM motoristas WHERE status='aprovado' AND online=1 AND loc_em > ?`, iso(agora - LOC_VALIDA_MIN * MIN)).filter((m) =>
      this.livreDoMotorista(m.id, bloco),
    );
  }
  disponibilidade() {
    const cfg = this.config();
    const agora = Date.now();
    const blocos = this.blocosAtivos(agora);
    const livresAgora = this.motoristasLivresAgora(agora).length;
    const agoraOk = !cfg.aberto
      ? { ok: false, motivo: 'Não estamos aceitando pedidos no momento.' }
      : !dentroDoHorario(cfg, agora)
        ? { ok: false, motivo: `Atendimento das ${cfg.horaInicio} às ${cfg.horaFim}.` }
        : livresAgora < 1
          ? { ok: false, motivo: 'Nenhum motorista livre agora. Agende um horário.' }
          : { ok: true };
    return { agora: agoraOk, dias: proximosDias(cfg, blocos, agora, 6, this.aprovados()), bloqueioMin: cfg.bloqueioMin };
  }

  // ---------- preço ----------
  private cotar(mercadoId: string, lat: number, lon: number, agendado: boolean) {
    const m = MERCADOS.find((x) => x.id === mercadoId);
    if (!m) return null;
    const r = rotasAteCasa({ lat, lon }, [m])[m.id];
    if (!r) return null;
    const cfg = this.config();
    const sugerido = precoSugerido(cfg.tarifas.map((t) => estimarIdaEVolta(r, t)), cfg.margem);
    return { mercado: m, valor: precoFrete(sugerido, agendado, cfg.urgencia), km: r2(r.kmIda + r.kmVolta), minutos: Math.round(r.minIda + r.minVolta) };
  }

  // ---------- autenticação ----------
  private quem(req: Request): Quem | null {
    const tk = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!tk) return null;
    if (this.env.ADMIN_TOKEN && tk === this.env.ADMIN_TOKEN) return { tipo: 'admin', id: 'admin' };
    const c = this.um(`SELECT * FROM clientes WHERE token=?`, tk);
    if (c) return { tipo: 'cliente', id: String(c.id), linha: c };
    const m = this.um(`SELECT * FROM motoristas WHERE token=?`, tk);
    if (m) return { tipo: 'motorista', id: String(m.id), linha: m };
    return null;
  }

  // ---------- visões ----------
  private motoristaPublico(id: unknown) {
    const m = id ? this.um(`SELECT id, nome, carro, placa, cor, selfie, lat, lon, loc_em, telefone FROM motoristas WHERE id=?`, id) : undefined;
    if (!m) return null;
    return { id: m.id, nome: String(m.nome).split(' ')[0], carro: m.carro, placa: m.placa, cor: m.cor, temFoto: !!m.selfie, lat: m.lat, lon: m.lon, locEm: m.loc_em, telefone: m.telefone };
  }
  private corridaParaCliente(c: Linha) {
    const ativa = ['aceito', 'aguardando_pagamento', 'pago', 'entregue'].includes(String(c.status));
    return {
      id: c.id, status: c.status, agendado: !!c.agendado, janela: c.janela, inicio: c.inicio, mercadoId: c.mercado_id, mercadoNome: c.mercado_nome,
      valor: c.valor, taxaIncluida: c.taxa_incluida, valorCobrado: c.valor_cobrado ?? r2(Number(c.valor) + Number(c.taxa_incluida)),
      checkoutUrl: c.status === 'aguardando_pagamento' ? c.checkout_url : null, receiptUrl: c.receipt_url, metodo: c.metodo,
      motivo: c.motivo, taxaAplicada: c.taxa_aplicada, criadoEm: c.criado_em, chegouEm: c.chegou_em, pagoEm: c.pago_em,
      esperaPagamentoMin: this.config().esperaPagamentoMin,
      motorista: ativa ? this.motoristaPublico(c.motorista_id) : null,
    };
  }
  private corridaParaMotorista(c: Linha) {
    const cli = this.um(`SELECT nome, telefone, endereco, lat, lon FROM clientes WHERE id=?`, c.cliente_id);
    const m = MERCADOS.find((x) => x.id === c.mercado_id);
    return {
      id: c.id, status: c.status, agendado: !!c.agendado, janela: c.janela, inicio: c.inicio, fim: c.fim,
      mercado: m ? { id: m.id, nome: m.nome, endereco: m.endereco.split(', Guaramirim')[0], lat: m.lat, lon: m.lon } : null,
      cliente: cli ? { nome: String(cli.nome).split(' ')[0], telefone: c.motorista_id ? cli.telefone : null, endereco: cli.endereco, lat: cli.lat, lon: cli.lon } : null,
      km: c.km, minutos: c.minutos, valor: c.valor,
      ganho: c.ganho_motorista ?? r2((Number(c.valor) * this.config().comissaoMotoristaPct) / 100),
      chegouEm: c.chegou_em, pagoEm: c.pago_em,
    };
  }

  // ---------- InfinitePay ----------
  private async confirmarPagamento(id: string, slug: string, tx: string, receiptUrl?: string | null) {
    const c = this.um(`SELECT * FROM corridas WHERE id=?`, id);
    if (!c) return null;
    if (c.status !== 'aguardando_pagamento') return c;
    const resp = await fetch(`${API_IP}/payment_check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: this.env.INFINITEPAY_HANDLE, order_nsu: id, transaction_nsu: tx, slug }),
    }).catch(() => null);
    const d = ((await resp?.json().catch(() => ({}))) ?? {}) as { success?: boolean; paid?: boolean; capture_method?: string };
    if (!(d.success && d.paid)) return c;
    const cfg = this.config();
    const agora = Date.now();
    const atual = this.um(`SELECT * FROM corridas WHERE id=?`, id)!; // pode ter mudado durante o await
    if (atual.status !== 'aguardando_pagamento') return atual;
    const fim = Math.max(Date.parse(String(atual.fim)), agora + cfg.bloqueioMin * MIN);
    this.sql.exec(
      `UPDATE corridas SET status='pago', pago_em=?, metodo=?, receipt_url=?, slug=?, transaction_nsu=?, ganho_motorista=?, fim=? WHERE id=?`,
      iso(agora), d.capture_method ?? null, receiptUrl ?? null, slug, tx, r2((Number(atual.valor) * cfg.comissaoMotoristaPct) / 100), iso(fim), id,
    );
    if (Number(atual.taxa_incluida) > 0)
      this.sql.exec(`UPDATE clientes SET taxa_pendente = MAX(0, taxa_pendente - ?) WHERE id=?`, atual.taxa_incluida, atual.cliente_id);
    const pago = this.um(`SELECT * FROM corridas WHERE id=?`, id)!;
    this.avisar(this.textoCorrida(pago, `💰 PAGO ${brl(Number(pago.valor_cobrado))} (${d.capture_method === 'pix' ? 'Pix' : 'cartão'}) — serviço iniciado`));
    return pago;
  }

  private async criarLinkPagamento(c: Linha, origem: string) {
    const cli = this.um(`SELECT * FROM clientes WHERE id=?`, c.cliente_id)!;
    const taxa = Number(cli.taxa_pendente ?? 0);
    const total = r2(Number(c.valor) + taxa);
    const cfg = this.config();
    const comChave = !!this.env.INFINITEPAY_API_KEY;
    const itens = [{ quantity: 1, price: Math.round(Number(c.valor) * 100), description: `Frete ${c.mercado_nome}` }];
    if (taxa > 0) itens.push({ quantity: 1, price: Math.round(taxa * 100), description: 'Taxa de deslocamento pendente' });
    const resp = await fetch(`${API_IP}/links`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(comChave ? { 'X-Api-Key': this.env.INFINITEPAY_API_KEY! } : {}) },
      body: JSON.stringify({
        handle: this.env.INFINITEPAY_HANDLE,
        items: itens,
        order_nsu: c.id,
        redirect_url: `${origem}/retorno`,
        webhook_url: `${origem}/webhook`,
        customer: { name: cli.nome, phone_number: cli.telefone ?? undefined },
        options: comChave ? { single_payment: true, valid_until: iso(Date.now() + (cfg.esperaPagamentoMin + 5) * MIN) } : undefined,
      }),
    }).catch(() => null);
    const d = ((await resp?.json().catch(() => ({}))) ?? {}) as { url?: string; message?: string };
    if (!resp?.ok || !d.url) throw new Error(d.message ?? 'Não foi possível gerar o pagamento.');
    return { url: d.url, taxa, total };
  }

  // ---------- agenda (.ics) ----------
  private ics(motoristaId?: string) {
    const f = (s: unknown) => String(s).replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const esc = (s: unknown) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (m) => '\\' + m);
    const filtro = motoristaId ? `AND c.motorista_id=?` : '';
    const linhas = this.q(
      `SELECT c.*, cl.nome AS cliente_nome, cl.endereco, cl.telefone, cl.lat, cl.lon FROM corridas c JOIN clientes cl ON cl.id=c.cliente_id
       WHERE c.status IN ('buscando','aceito','aguardando_pagamento','pago','entregue') ${filtro}`,
      ...(motoristaId ? [motoristaId] : []),
    );
    const ev = linhas.map((c) =>
      [
        'BEGIN:VEVENT', `UID:${c.id}@mercadofrete`, `DTSTAMP:${f(c.criado_em)}`, `DTSTART:${f(c.inicio)}`, `DTEND:${f(c.fim)}`,
        `SUMMARY:${esc(`${c.agendado ? '' : '🚨 '}Frete ${c.mercado_nome} → ${c.cliente_nome}`)}`, `LOCATION:${esc(c.endereco)}`,
        `DESCRIPTION:${esc(`${brl(Number(c.valor))} · Tel: ${c.telefone ?? '-'} · Mapa: https://www.google.com/maps/search/?api=1&query=${c.lat},${c.lon}`)}`,
        'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Frete em 15 minutos', 'TRIGGER:-PT15M', 'END:VALARM', 'END:VEVENT',
      ].join('\r\n'),
    );
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Mercado Frete//PT-BR', 'X-WR-CALNAME:Mercado Frete', 'X-PUBLISHED-TTL:PT5M', ...ev, 'END:VCALENDAR'].join('\r\n');
  }
  private async chaveAgenda(sufixo = '') {
    const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`agenda:${this.env.ADMIN_TOKEN}:${sufixo}`));
    return [...new Uint8Array(h)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // ---------- rotas ----------
  async fetch(req: Request): Promise<Response> {
    try {
      this.manutencao();
      return await this.rotear(req);
    } catch (e) {
      return erro((e as Error).message || 'Erro interno.', 500);
    }
  }

  private async corpo<T = Record<string, unknown>>(req: Request): Promise<T> {
    return ((await req.json().catch(() => ({}))) ?? {}) as T;
  }

  private async rotear(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const p = url.pathname;
    const metodo = req.method;
    const origem = url.origin;
    const agora = Date.now();
    const cfg = this.config();

    // ===== públicas =====
    if (metodo === 'GET' && p === '/v2/config')
      return json({ tarifas: cfg.tarifas, margem: cfg.margem, urgencia: cfg.urgencia, bloqueioMin: cfg.bloqueioMin, taxaDeslocamento: cfg.taxaDeslocamento, esperaPagamentoMin: cfg.esperaPagamentoMin });
    if (metodo === 'GET' && p === '/v2/disponibilidade') return json(this.disponibilidade());

    if (metodo === 'POST' && p === '/v2/clientes') {
      const b = await this.corpo<Record<string, unknown>>(req);
      const nome = String(b.nome ?? '').trim(), cpf = soDigitos(b.cpf), endereco = String(b.endereco ?? '').trim();
      if (nome.length < 3) return erro('Informe o nome completo.');
      if (!cpfValido(cpf)) return erro('CPF inválido.');
      if (endereco.length < 5 || typeof b.lat !== 'number' || typeof b.lon !== 'number') return erro('Informe o endereço e marque no mapa.');
      if (this.um(`SELECT id FROM clientes WHERE cpf=?`, cpf)) return erro('Já existe um cadastro com esse CPF. Fale com o suporte para recuperar o acesso.', 409);
      const id = novoId('cli'), token = crypto.randomUUID() + crypto.randomUUID();
      this.sql.exec(
        `INSERT INTO clientes (id, token, nome, cpf, telefone, foto, endereco, lat, lon, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        id, token, nome, cpf, soDigitos(b.telefone) || null, b.foto ?? null, endereco, b.lat, b.lon, iso(agora),
      );
      return json({ id, token });
    }
    if (metodo === 'POST' && p === '/v2/motoristas') {
      const b = await this.corpo<Record<string, unknown>>(req);
      const nome = String(b.nome ?? '').trim(), cpf = soDigitos(b.cpf), tel = soDigitos(b.telefone);
      const carro = String(b.carro ?? '').trim(), placa = String(b.placa ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (nome.length < 3) return erro('Informe o nome completo.');
      if (!cpfValido(cpf)) return erro('CPF inválido.');
      if (tel.length < 10) return erro('Informe o WhatsApp com DDD.');
      if (carro.length < 2) return erro('Informe o modelo do carro.');
      if (!/^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(placa)) return erro('Placa inválida (ex.: ABC1D23).');
      if (this.um(`SELECT id FROM motoristas WHERE cpf=?`, cpf)) return erro('Já existe um motorista com esse CPF.', 409);
      const id = novoId('mot'), token = crypto.randomUUID() + crypto.randomUUID();
      this.sql.exec(
        `INSERT INTO motoristas (id, token, nome, cpf, telefone, carro, placa, cor, pix, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        id, token, nome, cpf, tel, carro, placa, String(b.cor ?? '').trim() || null, String(b.pix ?? '').trim() || null, iso(agora),
      );
      this.avisar(`🆕 NOVO MOTORISTA para aprovar\n${nome} · ${carro} ${placa}\nWhatsApp: ${tel}\nAbra o Frete Admin para ver os documentos.`);
      return json({ id, token });
    }

    // InfinitePay
    if (metodo === 'GET' && p === '/retorno') {
      const q = url.searchParams;
      const id = q.get('order_nsu') ?? '';
      const slug = q.get('slug'), tx = q.get('transaction_nsu');
      const c = slug && tx ? await this.confirmarPagamento(id, slug, tx, q.get('receipt_url')) : this.um(`SELECT * FROM corridas WHERE id=?`, id);
      return paginaRetorno(this.env.APP_SCHEME, c?.status === 'pago', id);
    }
    if (metodo === 'POST' && p === '/webhook') {
      const b = await this.corpo<{ order_nsu?: string; invoice_slug?: string; transaction_nsu?: string; receipt_url?: string }>(req);
      if (!b.order_nsu || !b.invoice_slug || !b.transaction_nsu) return new Response('dados incompletos', { status: 400 });
      await this.confirmarPagamento(b.order_nsu, b.invoice_slug, b.transaction_nsu, b.receipt_url);
      return new Response('ok');
    }
    if (metodo === 'GET' && p === '/agenda.ics') {
      const k = url.searchParams.get('k'), mot = url.searchParams.get('m') ?? '';
      if (!this.env.ADMIN_TOKEN || k !== (await this.chaveAgenda(mot))) return new Response('não autorizado', { status: 403 });
      return new Response(this.ics(mot || undefined), { headers: { 'content-type': 'text/calendar; charset=utf-8' } });
    }

    // ===== autenticadas =====
    const eu = this.quem(req);
    if (!eu) return erro('Faça o cadastro ou entre novamente.', 401);

    // arquivos (fotos e documentos)
    if (metodo === 'POST' && p === '/v2/arquivos') {
      if (!this.env.DOCS) return erro('Armazenamento de documentos não configurado.', 503);
      const tipo = url.searchParams.get('tipo') ?? '';
      if (!['foto', 'selfie', 'cnh'].includes(tipo)) return erro('Tipo de arquivo inválido.');
      const dados = await req.arrayBuffer();
      if (dados.byteLength < 1000 || dados.byteLength > 4_000_000) return erro('A imagem precisa ter até 4 MB.');
      const chave = `${eu.tipo}/${eu.id}/${tipo}-${Date.now().toString(36)}.jpg`;
      await this.env.DOCS.put(chave, dados, { httpMetadata: { contentType: req.headers.get('content-type') ?? 'image/jpeg' } });
      const coluna = tipo === 'foto' ? 'foto' : tipo;
      if (eu.tipo === 'cliente' && tipo === 'foto') this.sql.exec(`UPDATE clientes SET foto=? WHERE id=?`, chave, eu.id);
      if (eu.tipo === 'motorista' && tipo !== 'foto') this.sql.exec(`UPDATE motoristas SET ${coluna}=? WHERE id=?`, chave, eu.id);
      return json({ chave });
    }

    if (eu.tipo === 'cliente') return this.rotasCliente(req, eu, p, metodo, origem);
    if (eu.tipo === 'motorista') return this.rotasMotorista(req, eu, p, metodo, origem);
    return this.rotasAdmin(req, url, p, metodo);
  }

  // ===== cliente =====
  private async rotasCliente(req: Request, eu: Quem, p: string, metodo: string, origem: string): Promise<Response> {
    const agora = Date.now();
    const cfg = this.config();
    const cli = eu.linha!;
    if (metodo === 'GET' && p === '/v2/eu')
      return json({ tipo: 'cliente', id: cli.id, nome: cli.nome, telefone: cli.telefone, endereco: cli.endereco, lat: cli.lat, lon: cli.lon, temFoto: !!cli.foto, taxaPendente: cli.taxa_pendente });
    if (metodo === 'PUT' && p === '/v2/eu') {
      const b = await this.corpo<Record<string, unknown>>(req);
      const endereco = b.endereco !== undefined ? String(b.endereco).trim() : cli.endereco;
      const lat = typeof b.lat === 'number' ? b.lat : cli.lat, lon = typeof b.lon === 'number' ? b.lon : cli.lon;
      const tel = b.telefone !== undefined ? soDigitos(b.telefone) || null : cli.telefone;
      const nome = b.nome !== undefined ? String(b.nome).trim() : cli.nome;
      this.sql.exec(`UPDATE clientes SET nome=?, telefone=?, endereco=?, lat=?, lon=? WHERE id=?`, nome, tel, endereco, lat, lon, cli.id);
      return json({ ok: true });
    }
    if (metodo === 'POST' && p === '/v2/corridas') {
      if (cli.bloqueado) return erro('Cadastro bloqueado. Fale com o suporte.', 403);
      if (this.um(`SELECT id FROM corridas WHERE cliente_id=? AND status IN ${ATIVAS} AND agendado=0`, cli.id))
        return erro('Você já tem um frete em andamento.', 409);
      const b = await this.corpo<{ mercadoId?: string; agendado?: boolean; inicio?: string }>(req);
      const agendado = !!b.agendado;
      const cot = this.cotar(String(b.mercadoId), Number(cli.lat), Number(cli.lon), agendado);
      if (!cot) return erro('Não há rota até o seu endereço a partir desse mercado.');
      let inicio = agora;
      if (agendado) {
        inicio = Date.parse(b.inicio ?? '');
        if (!Number.isFinite(inicio) || !horarioValido(inicio, cfg, this.blocosAtivos(agora), agora, this.aprovados()))
          return erro('Esse horário não está mais disponível. Escolha outro.', 409);
      } else {
        const d = this.disponibilidade().agora;
        if (!d.ok) return erro(d.motivo ?? 'Indisponível agora.', 409);
      }
      const id = novoId('frete');
      const janela = agendado ? `${rotuloDia(dataLocal(inicio), dataLocal(agora))} · ${horaLocal(inicio)}` : 'Agora';
      const ofertaAte = agendado ? inicio - 30 * MIN : agora + cfg.ofertaMin * MIN;
      this.sql.exec(
        `INSERT INTO corridas (id, cliente_id, mercado_id, mercado_nome, agendado, inicio, fim, janela, status, valor, km, minutos, taxa_incluida, criado_em, oferta_ate)
         VALUES (?,?,?,?,?,?,?,?, 'buscando', ?,?,?,?,?,?)`,
        id, cli.id, cot.mercado.id, cot.mercado.nome, agendado ? 1 : 0, iso(inicio), iso(inicio + cfg.bloqueioMin * MIN), janela,
        cot.valor, cot.km, cot.minutos, Number(cli.taxa_pendente ?? 0), iso(agora), iso(ofertaAte),
      );
      const c = this.um(`SELECT * FROM corridas WHERE id=?`, id)!;
      this.avisar(this.textoCorrida(c, agendado ? '📅 NOVO FRETE AGENDADO' : '🚨 NOVO FRETE URGENTE (agora)'));
      return json(this.corridaParaCliente(c));
    }
    if (metodo === 'GET' && p === '/v2/corridas') {
      const lista = this.q(`SELECT * FROM corridas WHERE cliente_id=? ORDER BY criado_em DESC LIMIT 30`, cli.id);
      return json(lista.map((c) => this.corridaParaCliente(c)));
    }
    if (metodo === 'GET' && p === '/v2/corridas/ativas') {
      const lista = this.q(
        `SELECT * FROM corridas WHERE cliente_id=? AND (status IN ${ATIVAS} OR ((status='entregue' OR status='cancelado') AND COALESCE(entregue_em, cancelado_em) > ?)) ORDER BY inicio`,
        cli.id, iso(agora - 2 * 60 * MIN),
      );
      return json(lista.map((c) => this.corridaParaCliente(c)));
    }
    const m = p.match(/^\/v2\/corridas\/([\w-]+)(\/[\w-]+)?$/);
    if (m) {
      const c = this.um(`SELECT * FROM corridas WHERE id=? AND cliente_id=?`, m[1], cli.id);
      if (!c) return erro('Corrida não encontrada.', 404);
      const acao = m[2];
      if (metodo === 'GET' && !acao) return json(this.corridaParaCliente(c));
      if (metodo === 'POST' && acao === '/cancelar') {
        if (c.status === 'aguardando_pagamento') this.cancelarComTaxa(c, 'cliente_cancelou', 'cliente');
        else if (['buscando', 'aceito'].includes(String(c.status))) {
          this.sql.exec(`UPDATE corridas SET status='cancelado', motivo='cliente_cancelou', cancelado_por='cliente', cancelado_em=?, fim=? WHERE id=?`, iso(agora), iso(agora), c.id);
          this.avisar(this.textoCorrida(c, '❌ FRETE CANCELADO pelo cliente — horário liberado'));
        } else return erro('Este frete não pode mais ser cancelado pelo app.', 409);
        return json(this.corridaParaCliente(this.um(`SELECT * FROM corridas WHERE id=?`, c.id)!));
      }
      if (metodo === 'GET' && acao === '/foto-motorista') return this.fotoMotorista(c.motorista_id);
      if (acao === '/mensagens') return this.mensagens(req, c, 'cliente');
    }
    return erro('Rota não encontrada.', 404);
  }

  private async fotoMotorista(id: unknown) {
    const m = id ? this.um(`SELECT selfie FROM motoristas WHERE id=?`, id) : undefined;
    if (!m?.selfie || !this.env.DOCS) return erro('Sem foto.', 404);
    const o = await this.env.DOCS.get(String(m.selfie));
    return o ? new Response(o.body, { headers: { 'content-type': o.httpMetadata?.contentType ?? 'image/jpeg' } }) : erro('Sem foto.', 404);
  }

  private async mensagens(req: Request, c: Linha, autor: 'cliente' | 'motorista') {
    if (req.method === 'POST') {
      const b = await this.corpo<{ texto?: string }>(req);
      const texto = String(b.texto ?? '').trim().slice(0, 500);
      if (!texto) return erro('Mensagem vazia.');
      if (!c.motorista_id) return erro('O chat abre quando um motorista aceitar o frete.', 409);
      this.sql.exec(`INSERT INTO mensagens (corrida_id, autor, texto, criado_em) VALUES (?,?,?,?)`, c.id, autor, texto, iso(Date.now()));
    }
    const depois = Number(new URL(req.url).searchParams.get('depois') ?? 0);
    return json(this.q(`SELECT id, autor, texto, criado_em AS criadoEm FROM mensagens WHERE corrida_id=? AND id>? ORDER BY id LIMIT 200`, c.id, depois));
  }

  // ===== motorista =====
  private async rotasMotorista(req: Request, eu: Quem, p: string, metodo: string, origem: string): Promise<Response> {
    const agora = Date.now();
    const cfg = this.config();
    const mot = eu.linha!;
    const aprovado = mot.status === 'aprovado';

    if (metodo === 'GET' && p === '/v2/eu') {
      const ganhos = this.um(`SELECT COALESCE(SUM(ganho_motorista),0) AS total, COUNT(*) AS n FROM corridas WHERE motorista_id=? AND status IN ('pago','entregue') AND repassado=0`, mot.id);
      return json({
        tipo: 'motorista', id: mot.id, nome: mot.nome, telefone: mot.telefone, carro: mot.carro, placa: mot.placa, cor: mot.cor, pix: mot.pix,
        status: mot.status, online: !!mot.online, temSelfie: !!mot.selfie, temCnh: !!mot.cnh, aReceber: ganhos?.total ?? 0, corridasAReceber: ganhos?.n ?? 0,
        comissaoPct: cfg.comissaoMotoristaPct, agendaLink: `${origem}/agenda.ics?m=${mot.id}&k=${await this.chaveAgenda(String(mot.id))}`,
      });
    }
    if (metodo === 'POST' && (p === '/v2/eu/online' || p === '/v2/eu/local')) {
      const b = await this.corpo<{ online?: boolean; lat?: number; lon?: number }>(req);
      if (p === '/v2/eu/online') {
        if (b.online && !aprovado) return erro('Seu cadastro ainda está em análise.', 403);
        // Documentos obrigatórios assim que o armazenamento (R2) estiver ativo.
        if (b.online && this.env.DOCS && (!mot.selfie || !mot.cnh)) return erro('Envie a selfie e a foto da CNH.', 403);
        this.sql.exec(`UPDATE motoristas SET online=? WHERE id=?`, b.online ? 1 : 0, mot.id);
      }
      if (typeof b.lat === 'number' && typeof b.lon === 'number') this.sql.exec(`UPDATE motoristas SET lat=?, lon=?, loc_em=? WHERE id=?`, b.lat, b.lon, iso(agora), mot.id);
      const ofertas = this.ofertasPara(this.um(`SELECT * FROM motoristas WHERE id=?`, mot.id)!);
      return json({ ok: true, ofertas: ofertas.length });
    }
    if (metodo === 'GET' && p === '/v2/ofertas') return json(this.ofertasPara(mot));
    const om = p.match(/^\/v2\/ofertas\/([\w-]+)\/(aceitar|recusar)$/);
    if (metodo === 'POST' && om) {
      const c = this.um(`SELECT * FROM corridas WHERE id=?`, om[1]);
      if (!c) return erro('Corrida não encontrada.', 404);
      if (om[2] === 'recusar') {
        this.sql.exec(`INSERT OR IGNORE INTO recusas (corrida_id, motorista_id) VALUES (?,?)`, c.id, mot.id);
        return json({ ok: true });
      }
      if (!aprovado) return erro('Cadastro em análise.', 403);
      if (c.status !== 'buscando') return erro('Outro motorista já aceitou essa corrida.', 409);
      if (!this.livreDoMotorista(mot.id, { inicio: Date.parse(String(c.inicio)), fim: Date.parse(String(c.fim)) }))
        return erro('Você já tem uma corrida nesse horário.', 409);
      this.sql.exec(`UPDATE corridas SET status='aceito', motorista_id=?, aceito_em=? WHERE id=? AND status='buscando'`, mot.id, iso(agora), c.id);
      const aceita = this.um(`SELECT * FROM corridas WHERE id=?`, c.id)!;
      this.avisar(this.textoCorrida(aceita, `✅ CORRIDA ACEITA por ${mot.nome}`));
      return json(this.corridaParaMotorista(aceita));
    }
    if (metodo === 'GET' && p === '/v2/agenda') {
      const lista = this.q(
        `SELECT * FROM corridas WHERE motorista_id=? AND (status IN ${ATIVAS} OR ((status='entregue' OR status='cancelado') AND COALESCE(entregue_em, cancelado_em) > ?)) ORDER BY inicio`,
        mot.id, iso(agora - 12 * 60 * MIN),
      );
      return json(lista.map((c) => this.corridaParaMotorista(c)));
    }
    if (metodo === 'GET' && p === '/v2/historico') {
      const lista = this.q(`SELECT * FROM corridas WHERE motorista_id=? ORDER BY inicio DESC LIMIT 50`, mot.id);
      return json(lista.map((c) => this.corridaParaMotorista(c)));
    }
    if (metodo === 'POST' && p === '/v2/eu/livre') {
      // "Estou livre": encerra o bloqueio das corridas já entregues.
      this.sql.exec(`UPDATE corridas SET fim=? WHERE motorista_id=? AND status='entregue' AND fim > ?`, iso(agora), mot.id, iso(agora));
      return json({ ok: true });
    }
    const cm = p.match(/^\/v2\/corridas\/([\w-]+)(\/[\w-]+)?$/);
    if (cm) {
      const c = this.um(`SELECT * FROM corridas WHERE id=? AND motorista_id=?`, cm[1], mot.id);
      if (!c) return erro('Corrida não encontrada.', 404);
      const acao = cm[2];
      if (metodo === 'GET' && !acao) return json(this.corridaParaMotorista(c));
      if (metodo === 'POST' && acao === '/cheguei') {
        if (c.status !== 'aceito') return erro('Essa corrida não está aguardando você no mercado.', 409);
        const link = await this.criarLinkPagamento(c, origem);
        this.sql.exec(
          `UPDATE corridas SET status='aguardando_pagamento', chegou_em=?, checkout_url=?, taxa_incluida=?, valor_cobrado=? WHERE id=?`,
          iso(agora), link.url, link.taxa, link.total, c.id,
        );
        return json(this.corridaParaMotorista(this.um(`SELECT * FROM corridas WHERE id=?`, c.id)!));
      }
      if (metodo === 'POST' && acao === '/entregue') {
        if (c.status !== 'pago') return erro('O frete ainda não foi pago.', 409);
        this.sql.exec(`UPDATE corridas SET status='entregue', entregue_em=? WHERE id=?`, iso(agora), c.id);
        return json(this.corridaParaMotorista(this.um(`SELECT * FROM corridas WHERE id=?`, c.id)!));
      }
      if (metodo === 'POST' && acao === '/nao-pagou') {
        if (c.status !== 'aguardando_pagamento') return erro('Só depois de chegar ao mercado.', 409);
        if (agora - Date.parse(String(c.chegou_em)) < 5 * MIN) return erro('Aguarde ao menos 5 minutos pelo pagamento.', 409);
        this.cancelarComTaxa(c, 'nao_pagou', 'motorista');
        return json({ ok: true });
      }
      if (metodo === 'POST' && acao === '/desistir') {
        if (c.status !== 'aceito') return erro('Não é possível desistir agora.', 409);
        // Volta a procurar outro motorista.
        const ate = c.agendado ? Date.parse(String(c.inicio)) - 30 * MIN : agora + cfg.ofertaMin * MIN;
        this.sql.exec(`UPDATE corridas SET status='buscando', motorista_id=NULL, aceito_em=NULL, oferta_ate=? WHERE id=?`, iso(ate), c.id);
        this.sql.exec(`INSERT OR IGNORE INTO recusas (corrida_id, motorista_id) VALUES (?,?)`, c.id, mot.id);
        this.avisar(this.textoCorrida(c, `↩️ ${mot.nome} desistiu — procurando outro motorista`));
        return json({ ok: true });
      }
      if (acao === '/mensagens') return this.mensagens(req, c, 'motorista');
    }
    return erro('Rota não encontrada.', 404);
  }

  /** Corridas que este motorista pode aceitar: livres no horário, não recusadas. */
  private ofertasPara(mot: Linha) {
    if (mot.status !== 'aprovado') return [];
    const agora = Date.now();
    const recentes = !!mot.online && !!mot.loc_em && Date.parse(String(mot.loc_em)) > agora - LOC_VALIDA_MIN * MIN;
    return this.q(
      `SELECT c.* FROM corridas c WHERE c.status='buscando' AND NOT EXISTS (SELECT 1 FROM recusas r WHERE r.corrida_id=c.id AND r.motorista_id=?) ORDER BY c.inicio`,
      mot.id,
    )
      .filter((c) => (c.agendado ? true : recentes))
      .filter((c) => this.livreDoMotorista(mot.id, { inicio: Date.parse(String(c.inicio)), fim: Date.parse(String(c.fim)) }))
      .map((c) => {
        const v = this.corridaParaMotorista(c);
        const ate = mot.lat != null && v.mercado ? r2(distanciaRetaKm(Number(mot.lat), Number(mot.lon), v.mercado.lat, v.mercado.lon) * 1.35) : null;
        return { ...v, cliente: v.cliente ? { ...v.cliente, telefone: null } : null, kmAteMercado: ate, ofertaAte: c.oferta_ate };
      });
  }

  // ===== admin =====
  private async rotasAdmin(req: Request, url: URL, p: string, metodo: string): Promise<Response> {
    const agora = Date.now();
    if (metodo === 'GET' && p === '/v2/admin/resumo') {
      const cfg = this.config();
      const conta = (sql: string, ...a: unknown[]) => Number(this.um(sql, ...a)?.n ?? 0);
      return json({
        config: cfg,
        disponibilidade: this.disponibilidade(),
        motoristasOnline: conta(`SELECT COUNT(*) AS n FROM motoristas WHERE online=1 AND status='aprovado'`),
        motoristasPendentes: conta(`SELECT COUNT(*) AS n FROM motoristas WHERE status='pendente'`),
        corridasAtivas: conta(`SELECT COUNT(*) AS n FROM corridas WHERE status IN ${ATIVAS}`),
        aRepassar: Number(this.um(`SELECT COALESCE(SUM(ganho_motorista),0) AS n FROM corridas WHERE status IN ('pago','entregue') AND repassado=0`)?.n ?? 0),
        faturamentoHoje: Number(this.um(`SELECT COALESCE(SUM(valor_cobrado),0) AS n FROM corridas WHERE pago_em >= ?`, iso(Date.parse(dataLocal(agora) + 'T03:00:00Z')))?.n ?? 0),
      });
    }
    if (metodo === 'GET' && p === '/v2/admin/corridas') {
      const lista = this.q(
        `SELECT c.*, cl.nome AS cliente_nome, cl.telefone AS cliente_telefone, cl.endereco AS cliente_endereco, cl.lat AS cliente_lat, cl.lon AS cliente_lon,
                m.nome AS motorista_nome, m.placa AS motorista_placa, m.telefone AS motorista_telefone, m.lat AS motorista_lat, m.lon AS motorista_lon, m.loc_em AS motorista_loc_em
         FROM corridas c JOIN clientes cl ON cl.id=c.cliente_id LEFT JOIN motoristas m ON m.id=c.motorista_id ORDER BY c.inicio DESC LIMIT 300`,
      );
      return json(lista);
    }
    if (metodo === 'GET' && p === '/v2/admin/motoristas')
      return json(
        this.q(`SELECT id, nome, cpf, telefone, carro, placa, cor, pix, status, online, lat, lon, loc_em, criado_em, selfie, cnh,
          (SELECT COALESCE(SUM(ganho_motorista),0) FROM corridas c WHERE c.motorista_id=motoristas.id AND c.status IN ('pago','entregue') AND c.repassado=0) AS a_repassar,
          (SELECT COUNT(*) FROM corridas c WHERE c.motorista_id=motoristas.id AND c.status IN ('pago','entregue')) AS corridas
          FROM motoristas ORDER BY (status='pendente') DESC, nome`),
      );
    if (metodo === 'GET' && p === '/v2/admin/clientes')
      return json(this.q(`SELECT id, nome, cpf, telefone, endereco, lat, lon, taxa_pendente, bloqueado, criado_em, foto,
        (SELECT COUNT(*) FROM corridas c WHERE c.cliente_id=clientes.id) AS corridas FROM clientes ORDER BY criado_em DESC LIMIT 500`));
    const mm = p.match(/^\/v2\/admin\/motoristas\/([\w-]+)\/(status|repasse)$/);
    if (metodo === 'POST' && mm) {
      const mot = this.um(`SELECT * FROM motoristas WHERE id=?`, mm[1]);
      if (!mot) return erro('Motorista não encontrado.', 404);
      if (mm[2] === 'status') {
        const b = await this.corpo<{ status?: string }>(req);
        if (!['aprovado', 'bloqueado', 'pendente'].includes(String(b.status))) return erro('Status inválido.');
        this.sql.exec(`UPDATE motoristas SET status=?, online=CASE WHEN ?='aprovado' THEN online ELSE 0 END WHERE id=?`, b.status, b.status, mot.id);
        return json({ ok: true });
      }
      const pend = this.um(`SELECT COALESCE(SUM(ganho_motorista),0) AS v, COUNT(*) AS n FROM corridas WHERE motorista_id=? AND status IN ('pago','entregue') AND repassado=0`, mot.id)!;
      this.sql.exec(`UPDATE corridas SET repassado=1 WHERE motorista_id=? AND status IN ('pago','entregue') AND repassado=0`, mot.id);
      this.sql.exec(`INSERT INTO repasses (id, motorista_id, valor, corridas, criado_em) VALUES (?,?,?,?,?)`, novoId('rep'), mot.id, pend.v, pend.n, iso(agora));
      return json({ ok: true, valor: pend.v, corridas: pend.n });
    }
    const cm = p.match(/^\/v2\/admin\/clientes\/([\w-]+)\/(bloquear|desbloquear|zerar-taxa)$/);
    if (metodo === 'POST' && cm) {
      if (cm[2] === 'zerar-taxa') this.sql.exec(`UPDATE clientes SET taxa_pendente=0 WHERE id=?`, cm[1]);
      else this.sql.exec(`UPDATE clientes SET bloqueado=? WHERE id=?`, cm[2] === 'bloquear' ? 1 : 0, cm[1]);
      return json({ ok: true });
    }
    const am = p.match(/^\/v2\/admin\/corridas\/([\w-]+)\/cancelar$/);
    if (metodo === 'POST' && am) {
      const c = this.um(`SELECT * FROM corridas WHERE id=?`, am[1]);
      if (!c) return erro('Corrida não encontrada.', 404);
      this.sql.exec(`UPDATE corridas SET status='cancelado', motivo='admin', cancelado_por='admin', cancelado_em=?, fim=? WHERE id=?`, iso(agora), iso(agora), c.id);
      this.avisar(this.textoCorrida(c, `❌ CORRIDA CANCELADA por você${c.pago_em ? ` — estornar ${brl(Number(c.valor_cobrado))} na InfinitePay` : ''}`));
      return json({ ok: true });
    }
    if (metodo === 'GET' && p === '/v2/admin/arquivo') {
      const chave = url.searchParams.get('chave') ?? '';
      if (!this.env.DOCS || !chave) return erro('Arquivo não encontrado.', 404);
      const o = await this.env.DOCS.get(chave);
      return o ? new Response(o.body, { headers: { 'content-type': o.httpMetadata?.contentType ?? 'image/jpeg' } }) : erro('Arquivo não encontrado.', 404);
    }
    if (metodo === 'PUT' && p === '/v2/admin/config') {
      const b = await this.corpo<Partial<Config>>(req);
      const cfg = { ...this.config(), ...b };
      if (!(cfg.bloqueioMin >= 10 && cfg.bloqueioMin <= 240 && cfg.passoMin >= 5 && cfg.comissaoMotoristaPct >= 0 && cfg.comissaoMotoristaPct <= 100))
        return erro('Valores inválidos.');
      this.salvarConfig(cfg);
      return json(cfg);
    }
    if (metodo === 'GET' && p === '/v2/admin/agenda-link') return json({ url: `${url.origin}/agenda.ics?k=${await this.chaveAgenda('')}` });
    if (metodo === 'POST' && p === '/v2/admin/whatsapp-teste') {
      const ok = await this.whatsapp('✅ Mercado Frete: avisos de pedidos ativados neste WhatsApp.');
      return ok ? json({ ok }) : erro(this.env.CALLMEBOT_APIKEY ? 'O CallMeBot não aceitou o envio. Confira número e chave.' : 'Falta cadastrar CALLMEBOT_APIKEY na Cloudflare.');
    }
    return erro('Rota não encontrada.', 404);
  }
}

export function paginaRetorno(scheme: string, pago: boolean, id: string) {
  const link = `${scheme}://pagamento?corrida=${encodeURIComponent(id)}&status=${pago ? 'pago' : 'aguardando'}`;
  const titulo = pago ? 'Pagamento confirmado!' : 'Pagamento em processamento';
  return new Response(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${titulo}</title><style>body{font-family:system-ui,sans-serif;background:#F2F5F3;color:#15201A;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;text-align:center}
a{display:inline-block;margin-top:16px;background:#1B8048;color:#fff;padding:14px 24px;border-radius:12px;text-decoration:none;font-weight:700}</style></head>
<body><div><h1>${titulo}</h1><p>${pago ? 'O motorista já pode pegar suas compras. Acompanhe pelo app.' : 'Assim que a InfinitePay confirmar, o app mostra o pagamento.'}</p>
<a href="${link}">Voltar ao Mercado Frete</a></div><script>location.href=${JSON.stringify(link)}</script></body></html>`,
    { headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}
