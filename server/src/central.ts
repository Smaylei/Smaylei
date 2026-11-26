// Central da MOVI (antigo Mercado Frete): um Durable Object com banco SQLite (consistência forte: um pedido por
// vez, então dois motoristas nunca aceitam a mesma corrida).
//
// Serviços (src/data/servicos.ts): toda corrida vai de uma COLETA a um DESTINO (casa, local cadastrado
// pelo Admin ou endereço livre). Fluxo (pagamento antecipado e retido):
//   pagamento_pendente ──(cliente paga no app)──▶ buscando  [valor RETIDO]
//   ──(motorista aceita)──▶ aceito ──(Cheguei: GPS na coleta)──▶ no_local
//   Cliente na coleta: ──(cliente confirma que o motorista está lá)──▶ em_andamento [LIBERADO] ──▶ entregue
//   Cliente fora (buscar compras/encomenda): ──(Coletei)──▶ em_andamento ──(Cheguei no destino: GPS)──
//     ──(cliente confirma o recebimento, ou o motorista conclui após a espera)──▶ entregue [LIBERADO]
// Transporte de vários dias: as viagens formam um pacote pago de uma vez (order_nsu = id do pacote).
// Cancelamentos antes da liberação geram ESTORNO (feito pelo dono no app da InfinitePay e marcado no
// Admin). Se o cliente cancelar ou não aparecer com o motorista já no local, a taxa de deslocamento
// vai para o motorista e o restante é estornado.
//
// Saldo do motorista = créditos liberados − saques (solicitados ou pagos). Saque 1x por semana, por
// Pix na chave CPF do motorista: o dono faz o Pix e marca a ordem como paga no Admin.

import { DurableObject } from 'cloudflare:workers';
import { cidadeDe, CIDADES, nomeCidade, type CidadeId } from '../../src/data/cidades';
import { LOCAIS_INICIAIS, LOCAIS_REGIAO } from '../../src/data/locais';
import { MERCADOS } from '../../src/data/mercados';
import {
  CATEGORIAS,
  LIBERACAO_PADRAO,
  livrePermitido,
  MARCA,
  precoServico,
  servicoPorId,
  SERVICOS,
  type Liberacao,
  type Ponta as PontaServico,
  type ServicoId,
} from '../../src/data/servicos';
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
import { distanciaDoMapa, rotaEntre } from '../../src/services/grafo';
import { caminhoOsrm, tabelaOsrm, trajetoEstimado, type Trajeto } from './rotas';
import { distanciaRetaKm, URGENCIA_PADRAO, type Tarifa, type Urgencia } from '../../src/services/preco';

export interface Env {
  CENTRAL: DurableObjectNamespace;
  DOCS?: R2Bucket;
  INFINITEPAY_HANDLE: string;
  INFINITEPAY_API_KEY?: string;
  ADMIN_TOKEN: string;
  APP_SCHEME: string;
}

export type Config = ConfigAgenda & Liberacao & {
  tarifas: Tarifa[];
  margem: number;
  urgencia: Urgencia;
  comissaoMotoristaPct: number; // parte do frete que vai para o saldo do motorista (80)
  taxaDeslocamento: number; // R$ do motorista se o cliente cancelar/não aparecer com ele já no local
  esperaPagamentoMin: number; // prazo para pagar depois de pedir (o horário fica reservado)
  esperaConfirmacaoMin: number; // quanto o motorista espera o cliente confirmar no local
  raioChegadaM: number; // distância máxima do mercado para tocar "Cheguei"
  ofertaMin: number; // quanto tempo uma corrida "agora" procura motorista
  saqueDias: number; // intervalo entre saques
  esperaBorrachariaMin: number; // espera do motorista na borracharia (entra no preço)
};

export const CONFIG_PADRAO: Config = {
  ...AGENDA_PADRAO,
  tarifas: TARIFAS_PADRAO,
  margem: 0,
  urgencia: URGENCIA_PADRAO,
  comissaoMotoristaPct: 80,
  taxaDeslocamento: 5,
  esperaPagamentoMin: 15,
  esperaConfirmacaoMin: 10,
  raioChegadaM: 300,
  ofertaMin: 5,
  saqueDias: 7,
  esperaBorrachariaMin: 20,
  ...LIBERACAO_PADRAO,
};
const AREA_M = 1500; // distância máxima de um endereço até as ruas do mapa (fora disso: fora da área)
const MAX_VIAGENS = 20;

const MIN = 60_000;
const DIA = 24 * 60 * MIN;
// Corridas que ocupam o motorista/horário.
const OCUPAM = `('buscando','aceito','no_local','em_andamento')`;
const COM_MOTORISTA = `('aceito','no_local','em_andamento')`;
const LOC_VALIDA_MIN = 3;
const API_IP = 'https://api.checkout.infinitepay.io';

type Linha = Record<string, string | number | null>;
type Ponto = { lat: number; lon: number };
type Ponta = Ponto & { nome: string; endereco: string; localId: string };
type Quem = { tipo: 'cliente' | 'motorista' | 'admin'; id: string; linha?: Linha };

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, authorization',
  'access-control-allow-methods': 'GET,POST,PUT,DELETE',
};
export const json = (d: unknown, status = 200) =>
  new Response(JSON.stringify(d), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...CORS } });
export const erro = (mensagem: string, status = 400) => json({ erro: mensagem }, status);
const brl = (v: number) => 'R$ ' + Number(v).toFixed(2).replace('.', ',');
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
CREATE TABLE IF NOT EXISTS creditos (
  id TEXT PRIMARY KEY, motorista_id TEXT NOT NULL, corrida_id TEXT, tipo TEXT NOT NULL, valor REAL NOT NULL, criado_em TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS avisos (
  id INTEGER PRIMARY KEY AUTOINCREMENT, texto TEXT NOT NULL, corrida_id TEXT, criado_em TEXT NOT NULL, lido INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS saques (
  id TEXT PRIMARY KEY, motorista_id TEXT NOT NULL, valor REAL NOT NULL, chave_pix TEXT NOT NULL, status TEXT NOT NULL,
  criado_em TEXT NOT NULL, pago_em TEXT, motivo TEXT);
CREATE TABLE IF NOT EXISTS locais (
  id TEXT PRIMARY KEY, categoria TEXT NOT NULL, nome TEXT NOT NULL, endereco TEXT NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL,
  ativo INTEGER NOT NULL DEFAULT 1, criado_em TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pacotes (
  id TEXT PRIMARY KEY, cliente_id TEXT NOT NULL, valor REAL NOT NULL, viagens INTEGER NOT NULL, checkout_url TEXT, criado_em TEXT NOT NULL, pago_em TEXT);
CREATE TABLE IF NOT EXISTS rotas_cache (chave TEXT PRIMARY KEY, km_ida REAL, km_volta REAL, min_ida REAL, min_volta REAL, criado_em TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS avaliacoes (
  corrida_id TEXT PRIMARY KEY, cliente_id TEXT NOT NULL, motorista_id TEXT, nota INTEGER NOT NULL, sugestao TEXT, criado_em TEXT NOT NULL, lida INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS gorjetas (
  id TEXT PRIMARY KEY, corrida_id TEXT NOT NULL, cliente_id TEXT NOT NULL, motorista_id TEXT NOT NULL, valor REAL NOT NULL, status TEXT NOT NULL,
  checkout_url TEXT, slug TEXT, transaction_nsu TEXT, metodo TEXT, receipt_url TEXT, criado_em TEXT NOT NULL, pago_em TEXT)
`;
// Colunas acrescentadas depois da primeira versão (o banco em produção já existe).
const COLUNAS_NOVAS = [`ALTER TABLE corridas ADD COLUMN pagamento_ate TEXT`, `ALTER TABLE corridas ADD COLUMN liberado_em TEXT`, `ALTER TABLE corridas ADD COLUMN reembolso REAL NOT NULL DEFAULT 0`, `ALTER TABLE corridas ADD COLUMN reembolsado_em TEXT`,
  ...['servico TEXT', 'descricao TEXT', 'coleta_nome TEXT', 'coleta_endereco TEXT', 'coleta_lat REAL', 'coleta_lon REAL', 'entrega_nome TEXT', 'entrega_endereco TEXT',
    'entrega_lat REAL', 'entrega_lon REAL', 'cliente_na_coleta INTEGER NOT NULL DEFAULT 1', 'retorno INTEGER NOT NULL DEFAULT 0', 'pacote_id TEXT', 'chegou_destino_em TEXT',
  ].map((c) => `ALTER TABLE corridas ADD COLUMN ${c}`),
  // lojistas: a loja é uma conta de solicitante com status (aprovação pelo Admin)
  'ALTER TABLE locais ADD COLUMN cidade TEXT',
  ...["tipo TEXT NOT NULL DEFAULT 'cliente'", 'loja_nome TEXT', 'cnpj TEXT', "status TEXT NOT NULL DEFAULT 'aprovado'"].map((c) => `ALTER TABLE clientes ADD COLUMN ${c}`)];

export const ROTULO: Record<string, string> = {
  pagamento_pendente: 'Aguardando pagamento',
  buscando: 'Procurando motorista',
  aceito: 'Motorista a caminho',
  no_local: 'Motorista no local',
  em_andamento: 'A caminho da entrega',
  entregue: 'Entregue',
  cancelado: 'Cancelado',
};

export class Central extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      for (const cmd of ESQUEMA.split(';').map((c) => c.trim()).filter(Boolean)) this.sql.exec(cmd);
      for (const cmd of COLUNAS_NOVAS) {
        try {
          this.sql.exec(cmd);
        } catch {
          // coluna já existe
        }
      }
      this.migrarV3();
      this.migrarV4();
    });
  }

  /** Corridas do fluxo antigo (pagamento no mercado) → fluxo novo. */
  private migrarV3() {
    if (this.um(`SELECT valor FROM config WHERE chave='migracao_v3'`)) return;
    const agora = iso(Date.now());
    for (const c of this.q(`SELECT * FROM corridas WHERE status IN ('pago','entregue') AND ganho_motorista IS NOT NULL AND repassado=0 AND motorista_id IS NOT NULL`))
      this.sql.exec(`INSERT INTO creditos (id, motorista_id, corrida_id, tipo, valor, criado_em) VALUES (?,?,?,?,?,?)`, novoId('cre'), c.motorista_id, c.id, 'corrida', c.ganho_motorista, agora);
    this.sql.exec(`UPDATE corridas SET status='entregue', entregue_em=COALESCE(entregue_em, ?), liberado_em=COALESCE(pago_em, ?) WHERE status='pago'`, agora, agora);
    this.sql.exec(`UPDATE corridas SET status='cancelado', motivo='migracao', cancelado_em=? WHERE status IN ('aguardando_pagamento','aceito','buscando')`, agora);
    this.sql.exec(`UPDATE clientes SET taxa_pendente=0`);
    this.sql.exec(`INSERT INTO config (chave, valor) VALUES ('migracao_v3', '1')`);
  }

  /** Serviços: coleta/entrega guardadas na corrida; lista de locais por categoria. */
  private migrarV4() {
    for (const c of this.q(`SELECT c.id, c.mercado_id, cl.nome, cl.endereco, cl.lat, cl.lon FROM corridas c JOIN clientes cl ON cl.id=c.cliente_id WHERE c.coleta_lat IS NULL`)) {
      const m = MERCADOS.find((x) => x.id === c.mercado_id);
      this.sql.exec(
        `UPDATE corridas SET servico='comigo', coleta_nome=?, coleta_endereco=?, coleta_lat=?, coleta_lon=?, entrega_nome='Casa', entrega_endereco=?, entrega_lat=?, entrega_lon=? WHERE id=?`,
        m?.nome ?? c.mercado_id, m?.endereco ?? '', m?.lat ?? c.lat, m?.lon ?? c.lon, c.endereco, c.lat, c.lon, c.id,
      );
    }
    for (const [chave, lista] of [['locais_v1', LOCAIS_INICIAIS], ['locais_v2', LOCAIS_REGIAO]] as const) {
      if (this.um(`SELECT valor FROM config WHERE chave=?`, chave)) continue;
      for (const l of lista)
        this.sql.exec(`INSERT OR IGNORE INTO locais (id, categoria, nome, endereco, lat, lon, criado_em) VALUES (?,?,?,?,?,?,?)`, l.id, l.categoria, l.nome, l.endereco, l.lat, l.lon, iso(Date.now()));
      this.sql.exec(`INSERT INTO config (chave, valor) VALUES (?, '1')`, chave);
    }
    // Serviços de lojista chegaram depois: liga uma vez na configuração já salva.
    if (!this.um(`SELECT valor FROM config WHERE chave='lib_lojista_v1'`)) {
      const cfg = this.config();
      for (const id of ['loja_entrega', 'loja_cliente'] as const) if (!cfg.servicosAtivos.includes(id)) cfg.servicosAtivos.push(id);
      this.salvarConfig(cfg);
      this.sql.exec(`INSERT INTO config (chave, valor) VALUES ('lib_lojista_v1', '1')`);
    }
    // Cidade de cada local (a lista da região tem o prefixo da cidade no id).
    const PREFIXO: Record<string, string> = { jar: 'jaragua', mas: 'massaranduba', joi: 'joinville', sch: 'schroeder' };
    for (const l of this.q(`SELECT id, lat, lon FROM locais WHERE cidade IS NULL`)) {
      const semente = [...LOCAIS_INICIAIS, ...LOCAIS_REGIAO].some((x) => x.id === l.id);
      const cidade = semente ? (PREFIXO[String(l.id).slice(0, 3)] ?? 'guaramirim') : cidadeDe({ lat: Number(l.lat), lon: Number(l.lon) });
      this.sql.exec(`UPDATE locais SET cidade=? WHERE id=?`, cidade, l.id);
    }
  }
  private locais(todos = false) {
    return this.q<{ id: string; categoria: string; nome: string; endereco: string; lat: number; lon: number; ativo: number; cidade: CidadeId | null }>(
      `SELECT id, categoria, nome, endereco, lat, lon, ativo, cidade FROM locais ${todos ? '' : 'WHERE ativo=1'} ORDER BY categoria, nome`,
    ).map((l) => ({ ...l, ativo: !!l.ativo, cidade: l.cidade ?? cidadeDe(l) }));
  }

  // ---------- utilidades de banco ----------
  private q<T extends Linha = Linha>(consulta: string, ...args: unknown[]): T[] {
    return this.sql.exec(consulta, ...args).toArray() as unknown as T[];
  }
  private um<T extends Linha = Linha>(consulta: string, ...args: unknown[]): T | undefined {
    return this.q<T>(consulta, ...args)[0];
  }
  private corrida(id: unknown) {
    return this.um(`SELECT * FROM corridas WHERE id=?`, id);
  }

  config(): Config {
    const l = this.um<{ valor: string }>(`SELECT valor FROM config WHERE chave='geral'`);
    return { ...CONFIG_PADRAO, ...(l ? JSON.parse(l.valor) : {}) };
  }
  private salvarConfig(c: Config) {
    this.sql.exec(`INSERT INTO config (chave, valor) VALUES ('geral', ?) ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor`, JSON.stringify(c));
  }

  // ---------- avisos internos para o App Admin (substituem o WhatsApp) ----------
  private avisar(texto: string, corridaId: unknown = null) {
    this.sql.exec(`INSERT INTO avisos (texto, corrida_id, criado_em) VALUES (?,?,?)`, texto, corridaId ?? null, iso(Date.now()));
  }
  private textoCorrida(c: Linha, cab: string) {
    const cli = this.um(`SELECT nome, telefone, endereco, lat, lon, tipo, loja_nome FROM clientes WHERE id=?`, c.cliente_id);
    const mot = c.motorista_id ? this.um(`SELECT nome, placa FROM motoristas WHERE id=?`, c.motorista_id) : undefined;
    return [
      cab,
      `Serviço: ${servicoPorId(c.servico).titulo}`,
      `Quando: ${c.agendado ? c.janela : `AGORA (${horaLocal(Date.parse(String(c.criado_em)))})`}`,
      cli?.tipo === 'lojista' ? `Loja: ${cli.loja_nome} (${cli.nome})` : `Cliente: ${cli?.nome ?? '-'}`,
      `Coleta: ${c.coleta_nome ?? c.mercado_nome}${c.coleta_endereco && c.coleta_nome !== 'Casa' ? ` (${c.coleta_endereco})` : ''}`,
      `Destino: ${c.entrega_nome && c.entrega_nome !== 'Casa' ? `${c.entrega_nome} (${c.entrega_endereco})` : (c.entrega_endereco ?? cli?.endereco ?? '-')}`,
      c.descricao ? `O que: ${c.descricao}` : '',
      `Frete: ${brl(Number(c.valor))}`,
      mot ? `Motorista: ${mot.nome} (${mot.placa})` : '',
      Number(c.reembolso) > 0 ? `⚠️ ESTORNAR ${brl(Number(c.reembolso))} ao cliente pelo app da InfinitePay` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  // ---------- dinheiro ----------
  private ganho(valor: number) {
    return r2((valor * this.config().comissaoMotoristaPct) / 100);
  }
  private creditar(motoristaId: unknown, corridaId: unknown, tipo: 'corrida' | 'taxa' | 'gorjeta', valor: number) {
    if (!motoristaId || valor <= 0) return;
    this.sql.exec(`INSERT INTO creditos (id, motorista_id, corrida_id, tipo, valor, criado_em) VALUES (?,?,?,?,?,?)`, novoId('cre'), motoristaId, corridaId, tipo, r2(valor), iso(Date.now()));
  }
  private notaMotorista(motoristaId: unknown) {
    const a = this.um(`SELECT AVG(nota) AS media, COUNT(*) AS n FROM avaliacoes WHERE motorista_id=?`, motoristaId);
    const g = this.um(`SELECT COALESCE(SUM(valor),0) AS v FROM gorjetas WHERE motorista_id=? AND status='paga'`, motoristaId);
    return { notaMedia: a?.n ? Math.round(Number(a.media) * 10) / 10 : null, avaliacoes: Number(a?.n ?? 0), gorjetasTotal: r2(Number(g?.v ?? 0)) };
  }
  /** Libera o valor retido para o saldo do motorista (uma vez só). */
  private liberar(c: Linha) {
    if (this.corrida(c.id)?.liberado_em) return;
    const ganho = this.ganho(Number(c.valor));
    this.sql.exec(`UPDATE corridas SET liberado_em=?, ganho_motorista=? WHERE id=?`, iso(Date.now()), ganho, c.id);
    this.creditar(c.motorista_id, c.id, 'corrida', ganho);
  }
  saldo(motoristaId: unknown) {
    const creditos = Number(this.um(`SELECT COALESCE(SUM(valor),0) AS v FROM creditos WHERE motorista_id=?`, motoristaId)?.v ?? 0);
    const sacado = Number(this.um(`SELECT COALESCE(SUM(valor),0) AS v FROM saques WHERE motorista_id=? AND status IN ('solicitado','pago')`, motoristaId)?.v ?? 0);
    const emLiberacao = this.q(`SELECT valor FROM corridas WHERE motorista_id=? AND status IN ('aceito','no_local','em_andamento') AND liberado_em IS NULL`, motoristaId).reduce((s, c) => s + this.ganho(Number(c.valor)), 0);
    const ultimo = this.um<{ criado_em: string }>(`SELECT criado_em FROM saques WHERE motorista_id=? AND status IN ('solicitado','pago') ORDER BY criado_em DESC LIMIT 1`, motoristaId);
    const proximo = ultimo ? Date.parse(ultimo.criado_em) + this.config().saqueDias * DIA : 0;
    return { disponivel: r2(creditos - sacado), emLiberacao: r2(emLiberacao), totalGanho: r2(creditos), proximoSaqueEm: proximo > Date.now() ? iso(proximo) : null };
  }

  /** Cancela a corrida. Se já foi paga e não liberada, gera estorno (menos a taxa, quando o motorista já estava no local). */
  private cancelar(c: Linha, motivo: string, por: string, cab: string) {
    const agora = iso(Date.now());
    const cfg = this.config();
    let reembolso = 0, taxa = 0;
    if (c.pago_em && !c.liberado_em) {
      if (c.status === 'no_local') {
        taxa = Math.min(cfg.taxaDeslocamento, Number(c.valor));
        this.creditar(c.motorista_id, c.id, 'taxa', taxa);
      }
      reembolso = r2(Number(c.valor) - taxa);
    }
    this.sql.exec(
      `UPDATE corridas SET status='cancelado', motivo=?, cancelado_por=?, cancelado_em=?, taxa_aplicada=?, reembolso=?, fim=? WHERE id=?`,
      motivo, por, agora, taxa, reembolso, agora, c.id,
    );
    const novo = this.corrida(c.id)!;
    if (c.pago_em) this.avisar(this.textoCorrida(novo, cab), c.id);
    return novo;
  }

  // ---------- manutenção (roda a cada requisição) ----------
  private manutencao() {
    const agora = Date.now();
    const cfg = this.config();
    this.sql.exec(`UPDATE corridas SET status='cancelado', motivo='nao_pago', cancelado_por='sistema', cancelado_em=? WHERE status='pagamento_pendente' AND pagamento_ate < ?`, iso(agora), iso(agora));
    for (const c of this.q(`SELECT * FROM corridas WHERE status='buscando' AND oferta_ate < ?`, iso(agora)))
      this.cancelar(c, 'sem_motorista', 'sistema', '⚠️ SEM MOTORISTA — corrida cancelada');
    this.sql.exec(`UPDATE motoristas SET online=0 WHERE online=1 AND (loc_em IS NULL OR loc_em < ?)`, iso(agora - 30 * MIN));
    void cfg;
  }

  // ---------- agenda ----------
  private blocosAtivos(agora: number): Bloco[] {
    return this.q<{ inicio: string; fim: string }>(
      `SELECT inicio, fim FROM corridas WHERE status IN ${OCUPAM} OR (status='pagamento_pendente' AND pagamento_ate > ?) OR (status='entregue' AND fim > ?)`,
      iso(agora), iso(agora),
    )
      .map((b) => ({ inicio: Date.parse(b.inicio), fim: Date.parse(b.fim) }))
      .filter((b) => b.fim > agora);
  }
  private aprovados(): number {
    return Number(this.um(`SELECT COUNT(*) AS n FROM motoristas WHERE status='aprovado'`)?.n ?? 0);
  }
  private livreDoMotorista(motoristaId: unknown, bloco: Bloco, ignorar?: unknown): boolean {
    return !this.q<{ inicio: string; fim: string; id: string }>(
      `SELECT id, inicio, fim FROM corridas WHERE motorista_id=? AND (status IN ${COM_MOTORISTA} OR status='entregue')`,
      motoristaId,
    ).some((c) => c.id !== ignorar && sobrepoeBloco({ inicio: Date.parse(c.inicio), fim: Date.parse(c.fim) }, bloco));
  }
  private motoristasLivresAgora(agora: number): Linha[] {
    const cfg = this.config();
    const bloco = { inicio: agora, fim: agora + cfg.bloqueioMin * MIN };
    return this.q(`SELECT * FROM motoristas WHERE status='aprovado' AND online=1 AND loc_em > ?`, iso(agora - LOC_VALIDA_MIN * MIN)).filter((m) => this.livreDoMotorista(m.id, bloco));
  }
  disponibilidade() {
    const cfg = this.config();
    const agora = Date.now();
    const blocos = this.blocosAtivos(agora);
    const livres = this.motoristasLivresAgora(agora).length;
    // Corridas "agora" já pagas esperando motorista também ocupam os livres.
    const esperando = Number(this.um(`SELECT COUNT(*) AS n FROM corridas WHERE agendado=0 AND status IN ('buscando','pagamento_pendente')`)?.n ?? 0);
    const agoraOk = !cfg.aberto
      ? { ok: false, motivo: 'Não estamos aceitando pedidos no momento.' }
      : !dentroDoHorario(cfg, agora)
        ? { ok: false, motivo: `Atendimento das ${cfg.horaInicio} às ${cfg.horaFim}.` }
        : livres - esperando < 1
          ? { ok: false, motivo: 'Nenhum motorista livre agora. Agende um horário.' }
          : { ok: true };
    return { agora: agoraOk, dias: proximosDias(cfg, blocos, agora, 6, this.aprovados()), bloqueioMin: cfg.bloqueioMin };
  }

  // ---------- preço ----------
  /** Ida e volta entre dois pontos: OSRM (com cache), o mapa de Guaramirim ou, sem nada, a linha reta. */
  private async trajetos(base: Ponto, pontos: Ponto[]): Promise<Trajeto[]> {
    const chave = (p: Ponto) => `${base.lat.toFixed(4)},${base.lon.toFixed(4)}|${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
    const validade = iso(Date.now() - 30 * DIA);
    const res: (Trajeto | null)[] = pontos.map((p) => {
      const c = this.um(`SELECT * FROM rotas_cache WHERE chave=? AND criado_em > ?`, chave(p), validade);
      return c ? { kmIda: Number(c.km_ida), kmVolta: Number(c.km_volta), minIda: Number(c.min_ida), minVolta: Number(c.min_volta) } : null;
    });
    const faltam = pontos.map((p, i) => ({ p, i })).filter((x) => !res[x.i]);
    for (let k = 0; k < faltam.length; k += 40) {
      const lote = faltam.slice(k, k + 40);
      const osrm = await tabelaOsrm(base, lote.map((x) => x.p));
      lote.forEach((x, j) => {
        const t = osrm[j];
        if (t) {
          res[x.i] = t;
          this.sql.exec(`INSERT OR REPLACE INTO rotas_cache (chave, km_ida, km_volta, min_ida, min_volta, criado_em) VALUES (?,?,?,?,?,?)`, chave(x.p), t.kmIda, t.kmVolta, t.minIda, t.minVolta, iso(Date.now()));
        }
      });
    }
    return pontos.map((p, i) => {
      if (res[i]) return res[i]!;
      const noMapa = distanciaDoMapa(base) < AREA_M && distanciaDoMapa(p) < AREA_M ? rotaEntre(base, p) : null;
      return noMapa ?? trajetoEstimado(base, p);
    });
  }

  private async cotar(servico: ServicoId, coleta: Ponto, entrega: Ponto, agendado: boolean) {
    const [r] = await this.trajetos(coleta, [entrega]);
    return { valor: precoServico(r, this.config(), servico, agendado), km: r2(r.kmIda + r.kmVolta), minutos: Math.round(r.minIda + r.minVolta) };
  }

  /** Ponto dentro de uma cidade liberada? */
  private foraDaArea(p: Ponto) {
    const c = cidadeDe(p);
    const cfg = this.config();
    if (!c) return `fora da região atendida (${CIDADES.filter((x) => cfg.cidadesAtivas.includes(x.id)).map((x) => x.nome).join(', ')})`;
    if (!cfg.cidadesAtivas.includes(c)) return `ainda não atendemos ${nomeCidade(c)}`;
    return null;
  }

  /** Uma ponta da viagem: a casa do cliente, um local cadastrado ou um endereço livre (dentro da área). */
  private ponta(b: unknown, cli: Linha, rotulo: string, def?: PontaServico): Ponta | string {
    const o = (b ?? {}) as { casa?: boolean; localId?: string; nome?: string; endereco?: string; lat?: number; lon?: number };
    const cfg = this.config();
    if (o.localId) {
      const cat = this.um(`SELECT categoria FROM locais WHERE id=?`, o.localId)?.categoria ?? 'mercado';
      if (!cfg.categoriasAtivas.includes(cat as never)) return `${rotulo}: por enquanto atendemos apenas ${cfg.categoriasAtivas.includes('mercado') ? 'os mercados' : 'os locais'} da lista.`;
      const l = this.um(`SELECT lat, lon FROM locais WHERE id=?`, o.localId);
      const fora = l ? this.foraDaArea({ lat: Number(l.lat), lon: Number(l.lon) }) : null;
      if (fora) return `${rotulo}: ${fora}.`;
    } else if (!o.casa && def && !livrePermitido(def, cfg)) return `${rotulo}: por enquanto atendemos apenas os mercados da lista.`;
    if (o.casa) {
      const fora = this.foraDaArea({ lat: Number(cli.lat), lon: Number(cli.lon) });
      if (fora) return `${rotulo}: ${fora}.`;
      return { nome: cli.tipo === 'lojista' ? String(cli.loja_nome ?? 'Loja') : 'Casa', endereco: String(cli.endereco), lat: Number(cli.lat), lon: Number(cli.lon), localId: 'casa' };
    }
    if (o.localId) {
      const l = this.um(`SELECT * FROM locais WHERE id=? AND ativo=1`, o.localId) ?? (MERCADOS.find((m) => m.id === o.localId) as unknown as Linha | undefined);
      if (!l) return `${rotulo}: local não encontrado.`;
      return { nome: String(l.nome), endereco: String(l.endereco), lat: Number(l.lat), lon: Number(l.lon), localId: String(l.id) };
    }
    const endereco = String(o.endereco ?? '').trim();
    if (endereco.length < 6) return `${rotulo}: informe o endereço completo (rua, número e bairro).`;
    if (typeof o.lat !== 'number' || typeof o.lon !== 'number') return `${rotulo}: marque o ponto no mapa.`;
    const fora = this.foraDaArea({ lat: o.lat, lon: o.lon });
    if (fora) return `${rotulo}: endereço ${fora}.`;
    return { nome: String(o.nome ?? '').trim().slice(0, 60) || endereco.split(',')[0], endereco: endereco.slice(0, 200), lat: o.lat, lon: o.lon, localId: 'outro' };
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
    return { id: m.id, nome: String(m.nome).split(' ')[0], carro: m.carro, placa: m.placa, cor: m.cor, temFoto: !!m.selfie, lat: m.lat, lon: m.lon, locEm: m.loc_em };
  }
  private corridaParaCliente(c: Linha) {
    const cfg = this.config();
    const comMotorista = ['aceito', 'no_local', 'em_andamento', 'entregue'].includes(String(c.status));
    return {
      id: c.id, status: c.status, agendado: !!c.agendado, janela: c.janela, inicio: c.inicio, mercadoId: c.mercado_id, mercadoNome: c.mercado_nome,
      valor: c.valor, checkoutUrl: c.status === 'pagamento_pendente' ? c.checkout_url : null, pagamentoAte: c.pagamento_ate,
      receiptUrl: c.receipt_url, metodo: c.metodo, motivo: c.motivo, taxaAplicada: c.taxa_aplicada, reembolso: c.reembolso, reembolsadoEm: c.reembolsado_em,
      criadoEm: c.criado_em, pagoEm: c.pago_em, chegouEm: c.chegou_em, liberadoEm: c.liberado_em, entregueEm: c.entregue_em,
      esperaConfirmacaoMin: cfg.esperaConfirmacaoMin, taxaDeslocamento: cfg.taxaDeslocamento,
      motorista: comMotorista ? this.motoristaPublico(c.motorista_id) : null,
      ...this.viagem(c),
      pacote: c.pacote_id ? this.um(`SELECT id, valor, viagens FROM pacotes WHERE id=?`, c.pacote_id) ?? null : null,
      mensagens: Number(this.um(`SELECT COUNT(*) AS n FROM mensagens WHERE corrida_id=?`, c.id)?.n ?? 0),
      avaliacao: this.um(`SELECT nota FROM avaliacoes WHERE corrida_id=?`, c.id)?.nota ?? null,
      gorjeta: this.um(`SELECT valor FROM gorjetas WHERE corrida_id=? AND status='paga'`, c.id)?.valor ?? null,
    };
  }
  /** Serviço, coleta e destino da viagem (iguais para cliente, motorista e admin). */
  private viagem(c: Linha) {
    const curto = (e: unknown) => String(e ?? '').split(/, Guaramirim/)[0];
    return {
      servico: (c.servico ?? 'comigo') as ServicoId, servicoTitulo: servicoPorId(c.servico).titulo, descricao: c.descricao,
      clienteNaColeta: c.cliente_na_coleta !== 0, retorno: c.retorno === 1, chegouDestinoEm: c.chegou_destino_em,
      coleta: { nome: c.coleta_nome, endereco: curto(c.coleta_endereco), lat: Number(c.coleta_lat), lon: Number(c.coleta_lon) },
      entrega: { nome: c.entrega_nome, endereco: curto(c.entrega_endereco), lat: Number(c.entrega_lat), lon: Number(c.entrega_lon) },
    };
  }
  private corridaParaMotorista(c: Linha) {
    const cli = this.um(`SELECT nome, tipo, loja_nome FROM clientes WHERE id=?`, c.cliente_id);
    const cfg = this.config();
    const v = this.viagem(c);
    const nomeCli = cli ? (cli.tipo === 'lojista' ? `${cli.loja_nome} (loja)` : String(cli.nome).split(' ')[0]) : '';
    return {
      id: c.id, status: c.status, agendado: !!c.agendado, janela: c.janela, inicio: c.inicio, fim: c.fim,
      ...v,
      // Campos antigos (versões anteriores do app do motorista): mercado = coleta, cliente = destino.
      mercado: { id: c.mercado_id, nome: v.coleta.nome, endereco: v.coleta.endereco, lat: v.coleta.lat, lon: v.coleta.lon },
      solicitante: nomeCli,
      cliente: cli ? { nome: nomeCli, telefone: null, endereco: v.entrega.endereco, lat: v.entrega.lat, lon: v.entrega.lon } : null,
      km: c.km, minutos: c.minutos, valor: c.valor, ganho: c.ganho_motorista ?? this.ganho(Number(c.valor)),
      gorjeta: this.um(`SELECT valor FROM gorjetas WHERE corrida_id=? AND status='paga'`, c.id)?.valor ?? null,
      chegouEm: c.chegou_em, liberadoEm: c.liberado_em, esperaConfirmacaoMin: cfg.esperaConfirmacaoMin, raioChegadaM: cfg.raioChegadaM, taxaDeslocamento: cfg.taxaDeslocamento,
    };
  }

  // ---------- InfinitePay ----------
  private async criarLink(c: Linha, cli: Linha, origem: string) {
    const cfg = this.config();
    return this.linkInfinitePay({
      orderNsu: String(c.id), valor: Number(c.valor), descricao: `${servicoPorId(c.servico).titulo}: ${c.coleta_nome ?? c.mercado_nome} → ${c.entrega_nome ?? 'casa'} - ${c.agendado ? c.janela : 'agora'}`,
      cli, origem, validoMin: cfg.esperaPagamentoMin + 5,
    });
  }

  /**
   * Gera o link do Checkout Integrado. Com a API Key: pagamento único, só Pix e cartão, e
   * eventual parcelamento com juros por conta de quem paga (a InfinitePay não permite
   * desligar o parcelamento; o app orienta "Pix ou cartão à vista").
   */
  private async linkInfinitePay(o: { orderNsu: string; valor: number; descricao: string; cli: Linha; origem: string; validoMin: number }) {
    const chave = this.env.INFINITEPAY_API_KEY;
    const corpo = {
      handle: this.env.INFINITEPAY_HANDLE,
      items: [{ quantity: 1, price: Math.round(o.valor * 100), description: o.descricao }],
      order_nsu: o.orderNsu,
      redirect_url: `${o.origem}/retorno`,
      webhook_url: `${o.origem}/webhook`,
      customer: { name: o.cli.nome, phone_number: o.cli.telefone ? `+55${soDigitos(o.cli.telefone).replace(/^55/, '')}` : undefined },
    };
    const basico = { single_payment: true, valid_until: iso(Date.now() + o.validoMin * MIN) };
    const tentativas = chave
      ? [{ ...basico, payment_methods_enabled: ['pix', 'credit_card'], assured_installments: 0 }, basico]
      : [undefined];
    let msg = 'Não foi possível gerar o pagamento.';
    for (const options of tentativas) {
      const resp = await fetch(`${API_IP}/links`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(chave ? { 'X-Api-Key': chave } : {}) },
        body: JSON.stringify({ ...corpo, options }),
      }).catch(() => null);
      const d = ((await resp?.json().catch(() => ({}))) ?? {}) as { url?: string; message?: string };
      if (resp?.ok && d.url) return d.url;
      msg = d.message ?? msg;
    }
    throw new Error(msg);
  }

  private async checarPagamento(orderNsu: string, slug: string, tx: string) {
    const resp = await fetch(`${API_IP}/payment_check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: this.env.INFINITEPAY_HANDLE, order_nsu: orderNsu, transaction_nsu: tx, slug }),
    }).catch(() => null);
    const d = ((await resp?.json().catch(() => ({}))) ?? {}) as { success?: boolean; paid?: boolean; capture_method?: string };
    return { pago: !!(d.success && d.paid), metodo: d.capture_method ?? null };
  }

  /** Gorjeta: 100% para o motorista, entra no saldo assim que a InfinitePay confirma. */
  private async confirmarGorjeta(id: string, slug: string, tx: string, receiptUrl?: string | null) {
    const g = this.um(`SELECT * FROM gorjetas WHERE id=?`, id);
    if (!g || g.status === 'paga') return g ?? null;
    const r = await this.checarPagamento(id, slug, tx);
    if (!r.pago) return g;
    const atual = this.um(`SELECT * FROM gorjetas WHERE id=?`, id)!;
    if (atual.status === 'paga') return atual;
    this.sql.exec(`UPDATE gorjetas SET status='paga', pago_em=?, metodo=?, slug=?, transaction_nsu=?, receipt_url=? WHERE id=?`, iso(Date.now()), r.metodo, slug, tx, receiptUrl ?? null, id);
    this.creditar(atual.motorista_id, atual.corrida_id, 'gorjeta', Number(atual.valor));
    const mot = this.um(`SELECT nome FROM motoristas WHERE id=?`, atual.motorista_id);
    this.avisar(`💚 GORJETA de ${brl(Number(atual.valor))} para ${mot?.nome ?? 'o motorista'} (${r.metodo === 'pix' ? 'Pix' : 'cartão'}) — já está no saldo dele`, atual.corrida_id);
    return this.um(`SELECT * FROM gorjetas WHERE id=?`, id)!;
  }

  private async confirmarPagamento(id: string, slug: string, tx: string, receiptUrl?: string | null) {
    if (id.startsWith('pac-')) return this.confirmarPacote(id, slug, tx, receiptUrl);
    const c = this.corrida(id);
    if (!c) return null;
    if (c.pago_em) return c;
    const r = await this.checarPagamento(id, slug, tx);
    if (!r.pago) return c;
    if (this.corrida(id)!.pago_em) return this.corrida(id)!; // pode ter mudado durante o await
    return this.marcarPago(id, r.metodo, slug, tx, receiptUrl, true);
  }

  /** Várias viagens pagas de uma vez (transporte de vários dias). */
  private async confirmarPacote(id: string, slug: string, tx: string, receiptUrl?: string | null) {
    const primeira = () => this.um(`SELECT * FROM corridas WHERE pacote_id=? ORDER BY inicio LIMIT 1`, id) ?? null;
    const pac = this.um(`SELECT * FROM pacotes WHERE id=?`, id);
    if (!pac || pac.pago_em) return primeira();
    const r = await this.checarPagamento(id, slug, tx);
    if (!r.pago || this.um(`SELECT pago_em FROM pacotes WHERE id=?`, id)?.pago_em) return primeira();
    this.sql.exec(`UPDATE pacotes SET pago_em=? WHERE id=?`, iso(Date.now()), id);
    const lista = this.q(`SELECT id FROM corridas WHERE pacote_id=? ORDER BY inicio`, id);
    for (const c of lista) this.marcarPago(String(c.id), r.metodo, slug, tx, receiptUrl, false);
    const p = primeira()!;
    this.avisar(this.textoCorrida(p, `💰 📅 PACOTE PAGO: ${lista.length} viagens, ${brl(Number(pac.valor))} (${r.metodo === 'pix' ? 'Pix' : 'cartão'}) — valor retido; cada viagem é liberada quando o motorista chega`), p.id);
    return p;
  }

  private marcarPago(id: string, metodo: string | null, slug: string, tx: string, receiptUrl: string | null | undefined, avisar: boolean) {
    const atual = this.corrida(id)!;
    const cfg = this.config();
    const agora = Date.now();
    this.sql.exec(`UPDATE corridas SET pago_em=?, metodo=?, receipt_url=?, slug=?, transaction_nsu=?, valor_cobrado=valor WHERE id=?`, iso(agora), metodo, receiptUrl ?? null, slug, tx, id);
    if (atual.status === 'pagamento_pendente') {
      const inicio = atual.agendado ? Date.parse(String(atual.inicio)) : agora;
      const ofertaAte = atual.agendado ? inicio - 30 * MIN : agora + cfg.ofertaMin * MIN;
      this.sql.exec(`UPDATE corridas SET status='buscando', inicio=?, fim=?, oferta_ate=? WHERE id=?`, iso(inicio), iso(inicio + cfg.bloqueioMin * MIN), iso(ofertaAte), id);
      const pago = this.corrida(id)!;
      if (avisar) this.avisar(this.textoCorrida(pago, `💰 ${pago.agendado ? '📅 AGENDADO' : '🚨 AGORA'} PAGO ${brl(Number(pago.valor))} (${metodo === 'pix' ? 'Pix' : 'cartão'}) — valor retido, procurando motorista`), id);
      return pago;
    }
    // Pagou depois do prazo (pedido já cancelado): devolver.
    this.sql.exec(`UPDATE corridas SET reembolso=valor WHERE id=?`, id);
    const tarde = this.corrida(id)!;
    this.avisar(this.textoCorrida(tarde, '⚠️ PAGAMENTO APÓS O PRAZO — pedido já estava cancelado'), id);
    return tarde;
  }

  // ---------- agenda (.ics) ----------
  private ics(motoristaId?: string) {
    const f = (s: unknown) => String(s).replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const esc = (s: unknown) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (m) => '\\' + m);
    const filtro = motoristaId ? `AND c.motorista_id=?` : '';
    const linhas = this.q(
      `SELECT c.*, cl.nome AS cliente_nome, cl.endereco, cl.telefone, cl.lat, cl.lon FROM corridas c JOIN clientes cl ON cl.id=c.cliente_id
       WHERE c.status IN ('buscando','aceito','no_local','em_andamento','entregue') ${filtro}`,
      ...(motoristaId ? [motoristaId] : []),
    );
    const ev = linhas.map((c) =>
      [
        'BEGIN:VEVENT', `UID:${c.id}@mercadofrete`, `DTSTAMP:${f(c.criado_em)}`, `DTSTART:${f(c.inicio)}`, `DTEND:${f(c.fim)}`,
        `SUMMARY:${esc(`${c.agendado ? '' : '🚨 '}${servicoPorId(c.servico).titulo}: ${c.coleta_nome ?? c.mercado_nome} → ${c.entrega_nome === 'Casa' ? c.cliente_nome : c.entrega_nome}`)}`,
        `LOCATION:${esc(c.coleta_endereco ?? c.endereco)}`,
        `DESCRIPTION:${esc(`${brl(Number(c.valor))}${c.descricao ? ` · ${c.descricao}` : ''} · Destino: ${c.entrega_endereco ?? c.endereco} · Mapa: https://www.google.com/maps/search/?api=1&query=${c.coleta_lat ?? c.lat},${c.coleta_lon ?? c.lon}`)}`,
        'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Frete em 15 minutos', 'TRIGGER:-PT15M', 'END:VALARM', 'END:VEVENT',
      ].join('\r\n'),
    );
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MOVI//PT-BR', `X-WR-CALNAME:${MARCA.nome}`, 'X-PUBLISHED-TTL:PT5M', ...ev, 'END:VCALENDAR'].join('\r\n');
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
    const agora = Date.now();
    const cfg = this.config();

    // ===== públicas =====
    if (metodo === 'GET' && p === '/v2/config')
      return json({
        tarifas: cfg.tarifas, margem: cfg.margem, urgencia: cfg.urgencia, bloqueioMin: cfg.bloqueioMin, taxaDeslocamento: cfg.taxaDeslocamento,
        esperaPagamentoMin: cfg.esperaPagamentoMin, esperaConfirmacaoMin: cfg.esperaConfirmacaoMin, comissaoMotoristaPct: cfg.comissaoMotoristaPct, aberto: cfg.aberto,
        esperaBorrachariaMin: cfg.esperaBorrachariaMin,
        servicosAtivos: cfg.servicosAtivos, categoriasAtivas: cfg.categoriasAtivas, outroEnderecoLoja: cfg.outroEnderecoLoja,
        cidadesAtivas: cfg.cidadesAtivas,
        locais: this.locais().filter((l) => cfg.categoriasAtivas.includes(l.categoria as never) && !!l.cidade && cfg.cidadesAtivas.includes(l.cidade)),
      });
    if (metodo === 'GET' && p === '/v2/disponibilidade') return json(this.disponibilidade());

    if (metodo === 'POST' && p === '/v2/clientes') {
      const b = await this.corpo<Record<string, unknown>>(req);
      const nome = String(b.nome ?? '').trim(), cpf = soDigitos(b.cpf), endereco = String(b.endereco ?? '').trim();
      if (nome.length < 3) return erro('Informe o nome completo.');
      if (!cpfValido(cpf)) return erro('CPF inválido.');
      if (endereco.length < 5 || typeof b.lat !== 'number' || typeof b.lon !== 'number') return erro('Informe o endereço e marque no mapa.');
      if (this.um(`SELECT id FROM clientes WHERE cpf=? AND tipo='cliente'`, cpf)) return erro('Já existe um cadastro com esse CPF. Fale com o suporte para recuperar o acesso.', 409);
      const id = novoId('cli'), token = crypto.randomUUID() + crypto.randomUUID();
      this.sql.exec(
        `INSERT INTO clientes (id, token, nome, cpf, telefone, foto, endereco, lat, lon, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        id, token, nome, cpf, soDigitos(b.telefone) || null, null, endereco, b.lat, b.lon, iso(agora),
      );
      return json({ id, token });
    }
    if (metodo === 'POST' && p === '/v2/lojistas') {
      const b = await this.corpo<Record<string, unknown>>(req);
      const nome = String(b.nome ?? '').trim(), cpf = soDigitos(b.cpf), loja = String(b.lojaNome ?? '').trim(), cnpj = soDigitos(b.cnpj);
      const endereco = String(b.endereco ?? '').trim(), tel = soDigitos(b.telefone);
      if (loja.length < 2) return erro('Informe o nome da loja.');
      if (cnpj && cnpj.length !== 14) return erro('CNPJ inválido (14 números).');
      if (nome.length < 3) return erro('Informe o nome do responsável.');
      if (!cpfValido(cpf)) return erro('CPF do responsável inválido.');
      if (tel.length < 10) return erro('Informe o telefone com DDD.');
      if (endereco.length < 5 || typeof b.lat !== 'number' || typeof b.lon !== 'number') return erro('Informe o endereço da loja e marque no mapa.');
      const fora = this.foraDaArea({ lat: b.lat, lon: b.lon });
      if (fora) return erro(`Loja ${fora}.`);
      if (this.um(`SELECT id FROM clientes WHERE tipo='lojista' AND ((cnpj IS NOT NULL AND cnpj=?) OR (loja_nome=? AND cpf=?))`, cnpj || '-', loja, cpf))
        return erro('Essa loja já tem cadastro. Fale com o suporte.', 409);
      const id = novoId('loja'), token = crypto.randomUUID() + crypto.randomUUID();
      this.sql.exec(
        `INSERT INTO clientes (id, token, nome, cpf, telefone, endereco, lat, lon, criado_em, tipo, loja_nome, cnpj, status) VALUES (?,?,?,?,?,?,?,?,?, 'lojista', ?,?, 'pendente')`,
        id, token, nome, cpf, tel, endereco, b.lat, b.lon, iso(agora), loja, cnpj || null,
      );
      this.avisar(`🏪 NOVO LOJISTA para aprovar\n${loja}${cnpj ? ` (CNPJ ${cnpj})` : ''}\nResponsável: ${nome}\n${endereco}`);
      return json({ id, token, status: 'pendente' });
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
      // A chave Pix dos saques é o CPF do motorista.
      this.sql.exec(
        `INSERT INTO motoristas (id, token, nome, cpf, telefone, carro, placa, cor, pix, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        id, token, nome, cpf, tel, carro, placa, String(b.cor ?? '').trim() || null, cpf, iso(agora),
      );
      this.avisar(`🆕 NOVO MOTORISTA para aprovar\n${nome} · ${carro} ${placa}\nVeja os documentos em Motoristas.`);
      return json({ id, token });
    }

    // InfinitePay
    if (metodo === 'GET' && p === '/retorno') {
      const q = url.searchParams;
      const id = q.get('order_nsu') ?? '';
      const slug = q.get('slug'), tx = q.get('transaction_nsu');
      if (id.startsWith('gorj-')) {
        const g = slug && tx ? await this.confirmarGorjeta(id, slug, tx, q.get('receipt_url')) : this.um(`SELECT * FROM gorjetas WHERE id=?`, id);
        return paginaRetorno(this.env.APP_SCHEME, g?.status === 'paga', String(g?.corrida_id ?? ''), true);
      }
      const c = slug && tx ? await this.confirmarPagamento(id, slug, tx, q.get('receipt_url')) : this.corrida(id);
      return paginaRetorno(this.env.APP_SCHEME, !!c?.pago_em, String(c?.id ?? id));
    }
    if (metodo === 'POST' && p === '/webhook') {
      const b = await this.corpo<{ order_nsu?: string; invoice_slug?: string; transaction_nsu?: string; receipt_url?: string }>(req);
      if (!b.order_nsu || !b.invoice_slug || !b.transaction_nsu) return new Response('dados incompletos', { status: 400 });
      if (b.order_nsu.startsWith('gorj-')) await this.confirmarGorjeta(b.order_nsu, b.invoice_slug, b.transaction_nsu, b.receipt_url);
      else await this.confirmarPagamento(b.order_nsu, b.invoice_slug, b.transaction_nsu, b.receipt_url);
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

    if (metodo === 'POST' && p === '/v2/arquivos') {
      if (!this.env.DOCS) return erro('Armazenamento de documentos não configurado.', 503);
      const tipo = url.searchParams.get('tipo') ?? '';
      if (!['foto', 'selfie', 'cnh'].includes(tipo)) return erro('Tipo de arquivo inválido.');
      const dados = await req.arrayBuffer();
      if (dados.byteLength < 1000 || dados.byteLength > 4_000_000) return erro('A imagem precisa ter até 4 MB.');
      const chave = `${eu.tipo}/${eu.id}/${tipo}-${Date.now().toString(36)}.jpg`;
      await this.env.DOCS.put(chave, dados, { httpMetadata: { contentType: req.headers.get('content-type') ?? 'image/jpeg' } });
      if (eu.tipo === 'cliente' && tipo === 'foto') this.sql.exec(`UPDATE clientes SET foto=? WHERE id=?`, chave, eu.id);
      if (eu.tipo === 'motorista' && tipo === 'selfie') this.sql.exec(`UPDATE motoristas SET selfie=? WHERE id=?`, chave, eu.id);
      if (eu.tipo === 'motorista' && tipo === 'cnh') this.sql.exec(`UPDATE motoristas SET cnh=? WHERE id=?`, chave, eu.id);
      return json({ chave });
    }

    // Preço e rota (mapa sem Google: OSRM/OpenStreetMap). O preço é o mesmo cobrado no pedido.
    if (metodo === 'POST' && p === '/v2/cotacoes') {
      const b = await this.corpo<{ servico?: string; agendado?: boolean; base?: Ponto; pontos?: (Ponto & { id: string })[] }>(req);
      const pts = (b.pontos ?? []).filter((x) => typeof x?.lat === 'number' && typeof x?.lon === 'number').slice(0, 80);
      if (!b.base || typeof b.base.lat !== 'number' || typeof b.base.lon !== 'number') return erro('Informe o ponto de partida.');
      const sv = servicoPorId(b.servico);
      const ts = await this.trajetos(b.base, pts);
      const cfg = this.config();
      return json(Object.fromEntries(pts.map((x, i) => [x.id, { valor: precoServico(ts[i], cfg, sv.id, !!b.agendado), km: r2(ts[i].kmIda + ts[i].kmVolta), minutos: Math.round(ts[i].minIda + ts[i].minVolta) }])));
    }
    if (metodo === 'GET' && p === '/v2/rota') {
      const n = (k: string) => (url.searchParams.get(k) ?? '').split(',').map(Number);
      const [la, lo] = n('de'), [lb, lob] = n('para');
      if (![la, lo, lb, lob].every(Number.isFinite)) return erro('Pontos inválidos.');
      const r = await caminhoOsrm({ lat: la, lon: lo }, { lat: lb, lon: lob });
      if (r) return json({ km: r2(r.km), min: Math.max(1, Math.round(r.min)), caminho: r.caminho });
      const t = trajetoEstimado({ lat: la, lon: lo }, { lat: lb, lon: lob });
      return json({ km: r2(t.kmIda), min: Math.max(1, Math.round(t.minIda)), caminho: [[la, lo], [lb, lob]], estimado: true });
    }

    if (eu.tipo === 'cliente') return this.rotasCliente(req, url, eu, p, metodo);
    if (eu.tipo === 'motorista') return this.rotasMotorista(req, url, eu, p, metodo);
    return this.rotasAdmin(req, url, p, metodo);
  }

  // ===== cliente =====
  private async rotasCliente(req: Request, url: URL, eu: Quem, p: string, metodo: string): Promise<Response> {
    const agora = Date.now();
    const cfg = this.config();
    const cli = eu.linha!;
    if (metodo === 'GET' && p === '/v2/eu')
      return json({
        tipo: cli.tipo === 'lojista' ? 'lojista' : 'cliente', id: cli.id, nome: cli.nome, telefone: cli.telefone, endereco: cli.endereco, lat: cli.lat, lon: cli.lon,
        temFoto: !!cli.foto, status: cli.status, lojaNome: cli.loja_nome, cnpj: cli.cnpj, cidade: cidadeDe({ lat: Number(cli.lat), lon: Number(cli.lon) }),
      });
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
      // Um pedido sem pagar por vez: o anterior é descartado.
      this.sql.exec(`UPDATE corridas SET status='cancelado', motivo='substituido', cancelado_em=? WHERE cliente_id=? AND status='pagamento_pendente'`, iso(agora), cli.id);
      const b = await this.corpo<{
        servico?: string; coleta?: unknown; entrega?: unknown; descricao?: string; mercadoId?: string;
        agendado?: boolean; inicio?: string; inicios?: string[]; voltas?: string[];
      }>(req);
      const sv = servicoPorId(b.servico ?? 'comigo');
      if (b.servico && !SERVICOS.some((x) => x.id === b.servico)) return erro('Serviço inválido.');
      // Versões antigas do app mandam só o mercado: coleta no mercado, entrega em casa.
      if (!cfg.servicosAtivos.includes(sv.id)) return erro(`“${sv.titulo}” ainda não está disponível. Em breve!`, 403);
      const souLoja = cli.tipo === 'lojista';
      if (sv.publico !== (souLoja ? 'lojista' : 'cliente')) return erro(souLoja ? 'Use os serviços da área do lojista.' : 'Serviço exclusivo para lojistas.', 403);
      if (souLoja && cli.status !== 'aprovado') return erro(cli.status === 'bloqueado' ? 'Loja bloqueada. Fale com o suporte.' : 'O cadastro da sua loja está em análise. Avisaremos quando for aprovado.', 403);
      const coleta = this.ponta(b.coleta ?? (b.mercadoId ? { localId: b.mercadoId } : undefined), cli, 'Coleta', sv.coleta);
      if (typeof coleta === 'string') return erro(coleta);
      const entrega = this.ponta(b.entrega ?? { casa: true }, cli, 'Destino', sv.entrega);
      if (typeof entrega === 'string') return erro(entrega);
      if (distanciaRetaKm(coleta.lat, coleta.lon, entrega.lat, entrega.lon) < 0.05) return erro('A coleta e o destino são o mesmo lugar.');
      const descricao = String(b.descricao ?? '').trim().slice(0, 300);
      if (sv.descricao && descricao.length < 3) return erro(`Informe: ${sv.descricao.rotulo.toLowerCase()}.`);
      const agendado = !!b.agendado;
      if (!agendado && this.um(`SELECT id FROM corridas WHERE cliente_id=? AND agendado=0 AND status IN ${OCUPAM}`, cli.id)) return erro('Você já tem um frete em andamento.', 409);
      const cot = await this.cotar(sv.id, coleta, entrega, agendado);

      // Viagens: uma agora, uma agendada ou (transporte) vários dias com ida e volta.
      const viagens: { inicio: number; volta: boolean }[] = [];
      if (!agendado) {
        const d = this.disponibilidade().agora;
        if (!d.ok) return erro(d.motivo ?? 'Indisponível agora.', 409);
        viagens.push({ inicio: agora, volta: false });
      } else {
        const idas = (b.inicios?.length ? b.inicios : [b.inicio ?? '']).map((x) => ({ inicio: Date.parse(String(x)), volta: false }));
        const voltas = (sv.variosDias ? (b.voltas ?? []) : []).map((x) => ({ inicio: Date.parse(String(x)), volta: true }));
        if (!sv.variosDias && idas.length > 1) return erro('Este serviço é agendado um dia por vez.');
        viagens.push(...idas, ...voltas);
        if (viagens.length > MAX_VIAGENS) return erro(`Agende até ${MAX_VIAGENS} viagens por vez.`);
        viagens.sort((x, y) => x.inicio - y.inicio);
        const blocos = this.blocosAtivos(agora);
        for (const v of viagens) {
          if (!Number.isFinite(v.inicio) || !horarioValido(v.inicio, cfg, blocos, agora, this.aprovados()))
            return erro(
              Number.isFinite(v.inicio) ? `O horário de ${rotuloDia(dataLocal(v.inicio), dataLocal(agora))} às ${horaLocal(v.inicio)} não está mais disponível.` : 'Escolha o horário.',
              409,
            );
          blocos.push({ inicio: v.inicio, fim: v.inicio + cfg.bloqueioMin * MIN });
        }
      }
      const pacote = viagens.length > 1 ? novoId('pac') : null;
      const ids: string[] = [];
      for (const v of viagens) {
        const [de, para] = v.volta ? [entrega, coleta] : [coleta, entrega];
        const id = novoId('frete');
        ids.push(id);
        const janela = agendado ? `${rotuloDia(dataLocal(v.inicio), dataLocal(agora))} · ${horaLocal(v.inicio)}` : 'Agora';
        this.sql.exec(
          `INSERT INTO corridas (id, cliente_id, mercado_id, mercado_nome, agendado, inicio, fim, janela, status, valor, km, minutos, criado_em, pagamento_ate,
             servico, descricao, coleta_nome, coleta_endereco, coleta_lat, coleta_lon, entrega_nome, entrega_endereco, entrega_lat, entrega_lon, cliente_na_coleta, retorno, pacote_id)
           VALUES (?,?,?,?,?,?,?,?, 'pagamento_pendente', ?,?,?,?,?, ?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          id, cli.id, de.localId, de.nome, agendado ? 1 : 0, iso(v.inicio), iso(v.inicio + cfg.bloqueioMin * MIN), janela,
          cot.valor, cot.km, cot.minutos, iso(agora), iso(agora + cfg.esperaPagamentoMin * MIN),
          sv.id, descricao || null, de.nome, de.endereco, de.lat, de.lon, para.nome, para.endereco, para.lat, para.lon, sv.clienteNaColeta ? 1 : 0, sv.retorno ? 1 : 0, pacote,
        );
      }
      try {
        let urlPg: string;
        if (pacote) {
          const total = r2(cot.valor * ids.length);
          this.sql.exec(`INSERT INTO pacotes (id, cliente_id, valor, viagens, criado_em) VALUES (?,?,?,?,?)`, pacote, cli.id, total, ids.length, iso(agora));
          urlPg = await this.linkInfinitePay({ orderNsu: pacote, valor: total, descricao: `${sv.titulo} - ${ids.length} viagens`, cli, origem: url.origin, validoMin: cfg.esperaPagamentoMin + 5 });
          this.sql.exec(`UPDATE pacotes SET checkout_url=? WHERE id=?`, urlPg, pacote);
        } else urlPg = await this.criarLink(this.corrida(ids[0])!, cli, url.origin);
        for (const id of ids) this.sql.exec(`UPDATE corridas SET checkout_url=? WHERE id=?`, urlPg, id);
      } catch (e) {
        for (const id of ids) this.sql.exec(`UPDATE corridas SET status='cancelado', motivo='erro_pagamento', cancelado_em=? WHERE id=?`, iso(agora), id);
        return erro((e as Error).message, 502);
      }
      return json(this.corridaParaCliente(this.corrida(ids[0])!));
    }
    if (metodo === 'GET' && p === '/v2/corridas') {
      const lista = this.q(`SELECT * FROM corridas WHERE cliente_id=? AND status!='pagamento_pendente' ORDER BY criado_em DESC LIMIT 30`, cli.id);
      return json(lista.map((c) => this.corridaParaCliente(c)));
    }
    if (metodo === 'GET' && p === '/v2/corridas/ativas') {
      const lista = this.q(
        `SELECT * FROM corridas WHERE cliente_id=? AND (status IN ${OCUPAM} OR (status IN ('entregue','cancelado') AND pago_em IS NOT NULL AND COALESCE(entregue_em, cancelado_em) > ?)) ORDER BY inicio`,
        cli.id, iso(agora - 2 * 60 * MIN),
      );
      return json(lista.map((c) => this.corridaParaCliente(c)));
    }
    const gm = p.match(/^\/v2\/gorjetas\/([\w-]+)$/);
    if (metodo === 'GET' && gm) {
      const g = this.um(`SELECT id, corrida_id AS corridaId, valor, status, checkout_url AS checkoutUrl, pago_em AS pagoEm, metodo FROM gorjetas WHERE id=? AND cliente_id=?`, gm[1], cli.id);
      return g ? json(g) : erro('Gorjeta não encontrada.', 404);
    }
    const m = p.match(/^\/v2\/corridas\/([\w-]+)(\/[\w-]+)?$/);
    if (m) {
      const c = this.um(`SELECT * FROM corridas WHERE id=? AND cliente_id=?`, m[1], cli.id);
      if (!c) return erro('Corrida não encontrada.', 404);
      const acao = m[2];
      if (metodo === 'GET' && !acao) return json(this.corridaParaCliente(c));
      if (metodo === 'POST' && acao === '/confirmar-motorista') {
        if (c.cliente_na_coleta === 0) return erro('Neste serviço você confirma quando receber.', 409);
        if (c.status !== 'no_local') return erro('O motorista ainda não informou que chegou.', 409);
        this.sql.exec(`UPDATE corridas SET status='em_andamento', fim=? WHERE id=?`, iso(agora + cfg.bloqueioMin * MIN), c.id);
        this.liberar(c);
        return json(this.corridaParaCliente(this.corrida(c.id)!));
      }
      if (metodo === 'POST' && acao === '/confirmar-recebimento') {
        if (c.cliente_na_coleta !== 0 || c.status !== 'em_andamento') return erro('Ainda não há entrega para confirmar.', 409);
        this.liberar(c);
        this.sql.exec(`UPDATE corridas SET status='entregue', entregue_em=? WHERE id=?`, iso(agora), c.id);
        return json(this.corridaParaCliente(this.corrida(c.id)!));
      }
      if (metodo === 'POST' && acao === '/cancelar') {
        if (c.status === 'pagamento_pendente') {
          this.sql.exec(
            `UPDATE corridas SET status='cancelado', motivo='cliente_cancelou', cancelado_por='cliente', cancelado_em=? WHERE status='pagamento_pendente' AND (id=? OR (pacote_id IS NOT NULL AND pacote_id=?))`,
            iso(agora), c.id, c.pacote_id,
          );
        } else if (['buscando', 'aceito', 'no_local'].includes(String(c.status))) {
          this.cancelar(c, 'cliente_cancelou', 'cliente', '❌ CANCELADO pelo cliente — horário liberado');
        } else return erro('Este frete não pode mais ser cancelado pelo app.', 409);
        return json(this.corridaParaCliente(this.corrida(c.id)!));
      }
      if (metodo === 'POST' && acao === '/avaliar') {
        if (c.status !== 'entregue') return erro('A avaliação fica disponível quando a entrega termina.', 409);
        if (this.um(`SELECT 1 AS x FROM avaliacoes WHERE corrida_id=?`, c.id)) return erro('Você já avaliou este frete. Obrigado!', 409);
        const b = await this.corpo<{ nota?: number; sugestao?: string }>(req);
        const nota = Math.round(Number(b.nota));
        if (!(nota >= 1 && nota <= 5)) return erro('Escolha de 1 a 5 estrelas.');
        const sugestao = String(b.sugestao ?? '').trim().slice(0, 1000) || null;
        this.sql.exec(`INSERT INTO avaliacoes (corrida_id, cliente_id, motorista_id, nota, sugestao, criado_em) VALUES (?,?,?,?,?,?)`, c.id, cli.id, c.motorista_id, nota, sugestao, iso(agora));
        const mot = c.motorista_id ? this.um(`SELECT nome FROM motoristas WHERE id=?`, c.motorista_id) : undefined;
        this.avisar(`${'⭐'.repeat(nota)} AVALIAÇÃO ${nota}/5 — ${cli.nome} sobre ${mot?.nome ?? 'o motorista'} (${c.mercado_nome})${sugestao ? `\n💡 Sugestão: ${sugestao.slice(0, 200)}` : ''}`, c.id);
        return json(this.corridaParaCliente(this.corrida(c.id)!));
      }
      if (metodo === 'POST' && acao === '/gorjeta') {
        if (c.status !== 'entregue' || !c.motorista_id) return erro('A gorjeta fica disponível quando a entrega termina.', 409);
        if (this.um(`SELECT 1 AS x FROM gorjetas WHERE corrida_id=? AND status='paga'`, c.id)) return erro('Você já deu gorjeta neste frete. Obrigado!', 409);
        const b = await this.corpo<{ valor?: number }>(req);
        const valor = r2(Number(b.valor));
        if (!(valor >= 1 && valor <= 200)) return erro('A gorjeta precisa ser entre R$ 1 e R$ 200.');
        this.sql.exec(`UPDATE gorjetas SET status='cancelada' WHERE corrida_id=? AND status='pendente'`, c.id);
        const id = novoId('gorj');
        const mot = this.um(`SELECT nome FROM motoristas WHERE id=?`, c.motorista_id);
        let checkoutUrl: string;
        try {
          checkoutUrl = await this.linkInfinitePay({ orderNsu: id, valor, descricao: `Gorjeta para ${String(mot?.nome ?? 'motorista').split(' ')[0]}`, cli, origem: url.origin, validoMin: 60 });
        } catch (e) {
          return erro(e instanceof Error ? e.message : 'Não foi possível gerar o pagamento.', 502);
        }
        this.sql.exec(`INSERT INTO gorjetas (id, corrida_id, cliente_id, motorista_id, valor, status, checkout_url, criado_em) VALUES (?,?,?,?,?,?,?,?)`, id, c.id, cli.id, c.motorista_id, valor, 'pendente', checkoutUrl, iso(agora));
        return json({ id, valor, checkoutUrl, status: 'pendente' });
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

  /** Chat da corrida: cliente, motorista da vez e suporte (você, pelo App Admin). */
  private async mensagens(req: Request, c: Linha, autor: 'cliente' | 'motorista' | 'suporte') {
    if (req.method === 'POST') {
      const b = await this.corpo<{ texto?: string }>(req);
      const texto = String(b.texto ?? '').trim().slice(0, 500);
      if (!texto) return erro('Mensagem vazia.');
      if (autor === 'motorista' && c.motorista_id === null) return erro('Corrida sem motorista.', 409);
      if (autor === 'cliente') this.avisar(`💬 Mensagem do cliente (${c.mercado_nome}): ${texto.slice(0, 120)}`, c.id);
      this.sql.exec(`INSERT INTO mensagens (corrida_id, autor, texto, criado_em) VALUES (?,?,?,?)`, c.id, autor, texto, iso(Date.now()));
    }
    const depois = Number(new URL(req.url).searchParams.get('depois') ?? 0);
    return json(this.q(`SELECT id, autor, texto, criado_em AS criadoEm FROM mensagens WHERE corrida_id=? AND id>? ORDER BY id LIMIT 200`, c.id, depois));
  }

  // ===== motorista =====
  private async rotasMotorista(req: Request, url: URL, eu: Quem, p: string, metodo: string): Promise<Response> {
    const agora = Date.now();
    const cfg = this.config();
    const mot = eu.linha!;
    const aprovado = mot.status === 'aprovado';

    if (metodo === 'GET' && p === '/v2/eu') {
      const s = this.saldo(mot.id);
      return json({
        tipo: 'motorista', id: mot.id, nome: mot.nome, telefone: mot.telefone, carro: mot.carro, placa: mot.placa, cor: mot.cor, pix: mot.cpf,
        status: mot.status, online: !!mot.online, temSelfie: !!mot.selfie, temCnh: !!mot.cnh, docsObrigatorios: !!this.env.DOCS,
        ...s, comissaoPct: cfg.comissaoMotoristaPct, ...this.notaMotorista(mot.id),
        agendaLink: `${url.origin}/agenda.ics?m=${mot.id}&k=${await this.chaveAgenda(String(mot.id))}`,
      });
    }
    if (metodo === 'GET' && p === '/v2/saldo') {
      return json({
        ...this.saldo(mot.id), chavePix: mot.cpf, saqueDias: cfg.saqueDias,
        creditos: this.q(`SELECT cr.id, cr.tipo, cr.valor, cr.criado_em AS criadoEm, c.mercado_nome AS mercado FROM creditos cr LEFT JOIN corridas c ON c.id=cr.corrida_id WHERE cr.motorista_id=? ORDER BY cr.criado_em DESC, cr.rowid DESC LIMIT 50`, mot.id),
        saques: this.q(`SELECT id, valor, status, chave_pix AS chavePix, criado_em AS criadoEm, pago_em AS pagoEm, motivo FROM saques WHERE motorista_id=? ORDER BY criado_em DESC LIMIT 30`, mot.id),
      });
    }
    if (metodo === 'POST' && p === '/v2/saques') {
      const s = this.saldo(mot.id);
      if (s.proximoSaqueEm) return erro(`Você poderá pedir o próximo saque em ${new Date(s.proximoSaqueEm).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.`, 409);
      if (s.disponivel < 1) return erro('Sem saldo disponível para saque.', 409);
      const id = novoId('saq');
      this.sql.exec(`INSERT INTO saques (id, motorista_id, valor, chave_pix, status, criado_em) VALUES (?,?,?,?,?,?)`, id, mot.id, s.disponivel, mot.cpf, 'solicitado', iso(agora));
      this.avisar(`💸 SAQUE SOLICITADO\n${mot.nome}: ${brl(s.disponivel)}\nPix (CPF): ${mot.cpf}\nVeja em Saques para marcar como pago.`);
      return json({ ok: true, valor: s.disponivel });
    }
    if (metodo === 'POST' && (p === '/v2/eu/online' || p === '/v2/eu/local')) {
      const b = await this.corpo<{ online?: boolean; lat?: number; lon?: number }>(req);
      if (p === '/v2/eu/online') {
        if (b.online && !aprovado) return erro('Seu cadastro ainda está em análise.', 403);
        if (b.online && this.env.DOCS && (!mot.selfie || !mot.cnh)) return erro('Envie a selfie e a foto da CNH.', 403);
        this.sql.exec(`UPDATE motoristas SET online=? WHERE id=?`, b.online ? 1 : 0, mot.id);
      }
      if (typeof b.lat === 'number' && typeof b.lon === 'number') this.sql.exec(`UPDATE motoristas SET lat=?, lon=?, loc_em=? WHERE id=?`, b.lat, b.lon, iso(agora), mot.id);
      return json({ ok: true, ofertas: this.ofertasPara(this.um(`SELECT * FROM motoristas WHERE id=?`, mot.id)!).length });
    }
    if (metodo === 'GET' && p === '/v2/ofertas') return json(this.ofertasPara(mot));
    if (metodo === 'GET' && p === '/v2/agenda-disponivel') {
      // Corridas agendadas (já pagas) que este parceiro pode assumir, separadas por dia.
      const hoje = dataLocal(agora);
      const dias: Record<string, { data: string; rotulo: string; corridas: unknown[] }> = {};
      for (const o of this.ofertasPara(mot).filter((x) => x.agendado)) {
        const d = dataLocal(Date.parse(String(o.inicio)));
        (dias[d] ??= { data: d, rotulo: rotuloDia(d, hoje), corridas: [] }).corridas.push(o);
      }
      return json(Object.values(dias).sort((a, b) => (a.data < b.data ? -1 : 1)));
    }
    const om = p.match(/^\/v2\/ofertas\/([\w-]+)\/(aceitar|recusar)$/);
    if (metodo === 'POST' && om) {
      const c = this.corrida(om[1]);
      if (!c) return erro('Corrida não encontrada.', 404);
      if (om[2] === 'recusar') {
        this.sql.exec(`INSERT OR IGNORE INTO recusas (corrida_id, motorista_id) VALUES (?,?)`, c.id, mot.id);
        return json({ ok: true });
      }
      if (!aprovado) return erro('Cadastro em análise.', 403);
      if (c.status !== 'buscando') return erro('Outro motorista já aceitou essa corrida.', 409);
      if (!this.livreDoMotorista(mot.id, { inicio: Date.parse(String(c.inicio)), fim: Date.parse(String(c.fim)) })) return erro('Você já tem uma corrida nesse horário.', 409);
      this.sql.exec(`UPDATE corridas SET status='aceito', motorista_id=?, aceito_em=? WHERE id=? AND status='buscando'`, mot.id, iso(agora), c.id);
      const aceita = this.corrida(c.id)!;
      this.avisar(this.textoCorrida(aceita, `✅ CORRIDA ACEITA por ${mot.nome}`), c.id);
      return json(this.corridaParaMotorista(aceita));
    }
    if (metodo === 'GET' && p === '/v2/agenda') {
      const lista = this.q(
        `SELECT * FROM corridas WHERE motorista_id=? AND (status IN ${COM_MOTORISTA} OR (status IN ('entregue','cancelado') AND COALESCE(entregue_em, cancelado_em) > ?)) ORDER BY inicio`,
        mot.id, iso(agora - 12 * 60 * MIN),
      );
      return json(lista.map((c) => this.corridaParaMotorista(c)));
    }
    if (metodo === 'GET' && p === '/v2/historico') {
      const lista = this.q(`SELECT * FROM corridas WHERE motorista_id=? ORDER BY inicio DESC LIMIT 50`, mot.id);
      return json(lista.map((c) => this.corridaParaMotorista(c)));
    }
    if (metodo === 'POST' && p === '/v2/eu/livre') {
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
        if (c.status !== 'aceito') return erro('Essa corrida não está indo para a coleta.', 409);
        const b = await this.corpo<{ lat?: number; lon?: number }>(req);
        if (typeof b.lat !== 'number' || typeof b.lon !== 'number') return erro('Ative a localização para confirmar a chegada.');
        const dist = distanciaRetaKm(b.lat, b.lon, Number(c.coleta_lat), Number(c.coleta_lon)) * 1000;
        this.sql.exec(`UPDATE motoristas SET lat=?, lon=?, loc_em=? WHERE id=?`, b.lat, b.lon, iso(agora), mot.id);
        if (dist > cfg.raioChegadaM) return erro(`Você está a ${Math.round(dist)} m da coleta (${c.coleta_nome}). Chegue ao local para confirmar.`, 409);
        this.sql.exec(`UPDATE corridas SET status='no_local', chegou_em=? WHERE id=?`, iso(agora), c.id);
        return json(this.corridaParaMotorista(this.corrida(c.id)!));
      }
      if (metodo === 'POST' && acao === '/coletei') {
        // Cliente não está na coleta (buscar compras / encomenda): o motorista retira e segue.
        if (c.cliente_na_coleta !== 0) return erro('Nesta corrida o cliente confirma a sua chegada.', 409);
        if (c.status !== 'no_local') return erro('Toque em "Cheguei" quando estiver na coleta.', 409);
        this.sql.exec(`UPDATE corridas SET status='em_andamento', fim=? WHERE id=?`, iso(agora + cfg.bloqueioMin * MIN), c.id);
        return json(this.corridaParaMotorista(this.corrida(c.id)!));
      }
      if (metodo === 'POST' && acao === '/cheguei-destino') {
        if (c.cliente_na_coleta !== 0 || c.status !== 'em_andamento') return erro('Ação indisponível agora.', 409);
        const b = await this.corpo<{ lat?: number; lon?: number }>(req);
        if (typeof b.lat !== 'number' || typeof b.lon !== 'number') return erro('Ative a localização para confirmar a chegada.');
        const dist = distanciaRetaKm(b.lat, b.lon, Number(c.entrega_lat), Number(c.entrega_lon)) * 1000;
        this.sql.exec(`UPDATE motoristas SET lat=?, lon=?, loc_em=? WHERE id=?`, b.lat, b.lon, iso(agora), mot.id);
        if (dist > cfg.raioChegadaM) return erro(`Você está a ${Math.round(dist)} m do destino. Chegue ao endereço de entrega para confirmar.`, 409);
        if (!c.chegou_destino_em) this.sql.exec(`UPDATE corridas SET chegou_destino_em=? WHERE id=?`, iso(agora), c.id);
        return json(this.corridaParaMotorista(this.corrida(c.id)!));
      }
      if (metodo === 'POST' && acao === '/entregue') {
        if (c.status !== 'em_andamento') return erro(c.status === 'no_local' ? 'Aguarde o cliente confirmar que você está no local.' : 'A corrida ainda não começou.', 409);
        if (c.cliente_na_coleta === 0 && !c.liberado_em) {
          // Sem a confirmação do cliente: só depois de chegar ao destino (GPS) e esperar o prazo.
          if (!c.chegou_destino_em) return erro('Toque em "Cheguei no destino" ao chegar à entrega.', 409);
          if (agora - Date.parse(String(c.chegou_destino_em)) < cfg.esperaConfirmacaoMin * MIN)
            return erro(`Aguarde o cliente confirmar o recebimento (até ${cfg.esperaConfirmacaoMin} min após a chegada).`, 409);
          this.liberar(c);
          this.avisar(this.textoCorrida(c, `📦 ENTREGUE sem confirmação do cliente — ${mot.nome} chegou ao destino (GPS) e esperou ${cfg.esperaConfirmacaoMin} min; valor liberado`), c.id);
        }
        this.sql.exec(`UPDATE corridas SET status='entregue', entregue_em=? WHERE id=?`, iso(agora), c.id);
        return json(this.corridaParaMotorista(this.corrida(c.id)!));
      }
      if (metodo === 'POST' && acao === '/cliente-ausente') {
        if (c.status !== 'no_local') return erro('Só depois de chegar ao local da coleta.', 409);
        if (c.cliente_na_coleta === 0) return erro('Problema na retirada? Fale com o suporte pelo chat.', 409);
        if (agora - Date.parse(String(c.chegou_em)) < cfg.esperaConfirmacaoMin * MIN) return erro(`Aguarde ${cfg.esperaConfirmacaoMin} minutos pela confirmação do cliente.`, 409);
        this.cancelar(c, 'cliente_ausente', 'motorista', `❌ CLIENTE NÃO APARECEU — taxa de ${brl(Math.min(cfg.taxaDeslocamento, Number(c.valor)))} para ${mot.nome}`);
        return json({ ok: true });
      }
      if (metodo === 'POST' && acao === '/desistir') {
        if (c.status !== 'aceito') return erro('Não é possível desistir agora.', 409);
        const ate = c.agendado ? Date.parse(String(c.inicio)) - 30 * MIN : agora + cfg.ofertaMin * MIN;
        this.sql.exec(`UPDATE corridas SET status='buscando', motorista_id=NULL, aceito_em=NULL, oferta_ate=? WHERE id=?`, iso(ate), c.id);
        this.sql.exec(`INSERT OR IGNORE INTO recusas (corrida_id, motorista_id) VALUES (?,?)`, c.id, mot.id);
        this.avisar(this.textoCorrida(c, `↩️ ${mot.nome} desistiu — procurando outro motorista`), c.id);
        return json({ ok: true });
      }
      if (acao === '/mensagens') return this.mensagens(req, c, 'motorista');
    }
    return erro('Rota não encontrada.', 404);
  }

  /** Corridas pagas que este motorista pode aceitar: livres no horário, não recusadas. */
  private ofertasPara(mot: Linha) {
    if (mot.status !== 'aprovado') return [];
    const agora = Date.now();
    const recentes = !!mot.online && !!mot.loc_em && Date.parse(String(mot.loc_em)) > agora - LOC_VALIDA_MIN * MIN;
    return this.q(`SELECT c.* FROM corridas c WHERE c.status='buscando' AND NOT EXISTS (SELECT 1 FROM recusas r WHERE r.corrida_id=c.id AND r.motorista_id=?) ORDER BY c.inicio`, mot.id)
      .filter((c) => (c.agendado ? true : recentes))
      .filter((c) => this.livreDoMotorista(mot.id, { inicio: Date.parse(String(c.inicio)), fim: Date.parse(String(c.fim)) }))
      .map((c) => {
        const v = this.corridaParaMotorista(c);
        const ate = mot.lat != null ? r2(distanciaRetaKm(Number(mot.lat), Number(mot.lon), v.coleta.lat, v.coleta.lon) * 1.35) : null;
        return { ...v, cliente: v.cliente ? { ...v.cliente, telefone: null } : null, kmAteMercado: ate, ofertaAte: c.oferta_ate };
      });
  }

  // ===== admin =====
  private async rotasAdmin(req: Request, url: URL, p: string, metodo: string): Promise<Response> {
    const agora = Date.now();
    if (metodo === 'GET' && p === '/v2/admin/resumo') {
      const cfg = this.config();
      const n = (sql: string, ...a: unknown[]) => Number(this.um(sql, ...a)?.n ?? 0);
      return json({
        config: cfg,
        disponibilidade: this.disponibilidade(),
        motoristasOnline: n(`SELECT COUNT(*) AS n FROM motoristas WHERE online=1 AND status='aprovado'`),
        motoristasPendentes: n(`SELECT COUNT(*) AS n FROM motoristas WHERE status='pendente'`),
        corridasAtivas: n(`SELECT COUNT(*) AS n FROM corridas WHERE status IN ${OCUPAM}`),
        retido: n(`SELECT COALESCE(SUM(valor),0) AS n FROM corridas WHERE pago_em IS NOT NULL AND liberado_em IS NULL AND status IN ('buscando','aceito','no_local','em_andamento')`),
        saquesPendentes: n(`SELECT COALESCE(SUM(valor),0) AS n FROM saques WHERE status='solicitado'`),
        saquesPendentesQtd: n(`SELECT COUNT(*) AS n FROM saques WHERE status='solicitado'`),
        estornosPendentes: n(`SELECT COALESCE(SUM(reembolso),0) AS n FROM corridas WHERE reembolso > 0 AND reembolsado_em IS NULL`),
        estornosPendentesQtd: n(`SELECT COUNT(*) AS n FROM corridas WHERE reembolso > 0 AND reembolsado_em IS NULL`),
        avisosNaoLidos: n(`SELECT COUNT(*) AS n FROM avisos WHERE lido=0`),
        lojistasPendentes: n(`SELECT COUNT(*) AS n FROM clientes WHERE tipo='lojista' AND status='pendente'`),
        avaliacoesNaoLidas: n(`SELECT COUNT(*) AS n FROM avaliacoes WHERE lida=0`),
        notaMedia: Math.round(n(`SELECT COALESCE(AVG(nota),0) AS n FROM avaliacoes`) * 10) / 10,
        gorjetasHoje: n(`SELECT COALESCE(SUM(valor),0) AS n FROM gorjetas WHERE status='paga' AND pago_em >= ?`, iso(Date.parse(dataLocal(agora) + 'T03:00:00Z'))),
        faturamentoHoje: n(`SELECT COALESCE(SUM(valor),0) AS n FROM corridas WHERE pago_em >= ? AND status!='cancelado'`, iso(Date.parse(dataLocal(agora) + 'T03:00:00Z'))),
      });
    }
    if (metodo === 'GET' && p === '/v2/admin/avisos') {
      const depois = Number(url.searchParams.get('depois') ?? 0);
      return json({
        naoLidos: Number(this.um(`SELECT COUNT(*) AS n FROM avisos WHERE lido=0`)?.n ?? 0),
        avisos: this.q(`SELECT id, texto, corrida_id AS corridaId, criado_em AS criadoEm, lido FROM avisos WHERE id>? ORDER BY id DESC LIMIT 100`, depois),
      });
    }
    if (metodo === 'GET' && p === '/v2/admin/avaliacoes') {
      // Avaliações e sugestões: só a administração vê (o motorista vê apenas a média).
      const lista = this.q(`SELECT a.corrida_id AS corridaId, a.nota, a.sugestao, a.criado_em AS criadoEm, a.lida,
          cl.nome AS clienteNome, m.nome AS motoristaNome, c.mercado_nome AS mercado, c.valor,
          (SELECT g.valor FROM gorjetas g WHERE g.corrida_id=a.corrida_id AND g.status='paga') AS gorjeta
        FROM avaliacoes a JOIN corridas c ON c.id=a.corrida_id JOIN clientes cl ON cl.id=a.cliente_id LEFT JOIN motoristas m ON m.id=a.motorista_id
        ORDER BY a.criado_em DESC LIMIT 300`);
      const r = this.um(`SELECT AVG(nota) AS media, COUNT(*) AS n, SUM(sugestao IS NOT NULL) AS s FROM avaliacoes`);
      const g = this.um(`SELECT COALESCE(SUM(valor),0) AS v, COUNT(*) AS n FROM gorjetas WHERE status='paga'`);
      return json({
        media: r?.n ? Math.round(Number(r.media) * 10) / 10 : null, total: Number(r?.n ?? 0), comSugestao: Number(r?.s ?? 0),
        gorjetas: { total: r2(Number(g?.v ?? 0)), quantidade: Number(g?.n ?? 0) },
        avaliacoes: lista,
      });
    }
    if (metodo === 'POST' && p === '/v2/admin/avaliacoes/lidas') {
      this.sql.exec(`UPDATE avaliacoes SET lida=1 WHERE lida=0`);
      return json({ ok: true });
    }
    if (metodo === 'POST' && p === '/v2/admin/avisos/lidos') {
      this.sql.exec(`UPDATE avisos SET lido=1 WHERE lido=0`);
      return json({ ok: true });
    }
    const chm = p.match(/^\/v2\/admin\/corridas\/([\w-]+)\/mensagens$/);
    if (chm) {
      const c = this.corrida(chm[1]);
      if (!c) return erro('Corrida não encontrada.', 404);
      return this.mensagens(req, c, 'suporte');
    }
    if (metodo === 'GET' && p === '/v2/admin/corridas')
      return json(
        this.q(`SELECT c.*, cl.nome AS cliente_nome, cl.telefone AS cliente_telefone, cl.endereco AS cliente_endereco, cl.lat AS cliente_lat, cl.lon AS cliente_lon,
                m.nome AS motorista_nome, m.placa AS motorista_placa, m.telefone AS motorista_telefone
         FROM corridas c JOIN clientes cl ON cl.id=c.cliente_id LEFT JOIN motoristas m ON m.id=c.motorista_id
         WHERE c.status!='pagamento_pendente' OR c.pagamento_ate > ? ORDER BY c.inicio DESC LIMIT 300`, iso(agora)),
      );
    if (metodo === 'GET' && p === '/v2/admin/motoristas')
      return json(
        this.q(`SELECT id, nome, cpf, telefone, carro, placa, cor, status, online, lat, lon, loc_em, criado_em, selfie, cnh,
          (SELECT COUNT(*) FROM corridas c WHERE c.motorista_id=motoristas.id AND c.status IN ('em_andamento','entregue')) AS corridas
          FROM motoristas ORDER BY (status='pendente') DESC, nome`).map((m) => ({ ...m, ...this.saldo(m.id), ...this.notaMotorista(m.id) })),
      );
    if (metodo === 'GET' && p === '/v2/admin/lojistas')
      return json(this.q(`SELECT id, nome, cpf, telefone, endereco, lat, lon, loja_nome, cnpj, status, criado_em,
        (SELECT COUNT(*) FROM corridas c WHERE c.cliente_id=clientes.id AND c.pago_em IS NOT NULL) AS corridas
        FROM clientes WHERE tipo='lojista' ORDER BY (status='pendente') DESC, loja_nome`));
    const ljm = p.match(/^\/v2\/admin\/lojistas\/([\w-]+)\/status$/);
    if (metodo === 'POST' && ljm) {
      const b = await this.corpo<{ status?: string }>(req);
      if (!['aprovado', 'bloqueado', 'pendente'].includes(String(b.status))) return erro('Status inválido.');
      this.sql.exec(`UPDATE clientes SET status=? WHERE id=? AND tipo='lojista'`, b.status, ljm[1]);
      return json({ ok: true });
    }
    if (metodo === 'GET' && p === '/v2/admin/clientes')
      return json(this.q(`SELECT id, nome, cpf, telefone, endereco, lat, lon, bloqueado, criado_em, foto,
        (SELECT COUNT(*) FROM corridas c WHERE c.cliente_id=clientes.id AND c.pago_em IS NOT NULL) AS corridas FROM clientes WHERE tipo='cliente' ORDER BY criado_em DESC LIMIT 500`));
    if (metodo === 'GET' && p === '/v2/admin/saques')
      return json(this.q(`SELECT s.*, m.nome AS motorista_nome, m.telefone AS motorista_telefone FROM saques s JOIN motoristas m ON m.id=s.motorista_id ORDER BY (s.status='solicitado') DESC, s.criado_em DESC LIMIT 200`));
    const sm = p.match(/^\/v2\/admin\/saques\/([\w-]+)\/(pagar|recusar)$/);
    if (metodo === 'POST' && sm) {
      const s = this.um(`SELECT * FROM saques WHERE id=?`, sm[1]);
      if (!s) return erro('Saque não encontrado.', 404);
      if (s.status !== 'solicitado') return erro('Esse saque já foi resolvido.', 409);
      const b = await this.corpo<{ motivo?: string }>(req);
      if (sm[2] === 'pagar') this.sql.exec(`UPDATE saques SET status='pago', pago_em=? WHERE id=?`, iso(agora), s.id);
      else this.sql.exec(`UPDATE saques SET status='recusado', motivo=? WHERE id=?`, String(b.motivo ?? '').slice(0, 200) || null, s.id);
      return json({ ok: true });
    }
    if (metodo === 'GET' && p === '/v2/admin/estornos')
      return json(this.q(`SELECT c.id, c.valor, c.reembolso, c.reembolsado_em, c.motivo, c.cancelado_em, c.receipt_url, c.metodo, c.mercado_nome, c.taxa_aplicada,
        cl.nome AS cliente_nome, cl.telefone AS cliente_telefone FROM corridas c JOIN clientes cl ON cl.id=c.cliente_id WHERE c.reembolso > 0 ORDER BY (c.reembolsado_em IS NULL) DESC, c.cancelado_em DESC LIMIT 200`));
    const em = p.match(/^\/v2\/admin\/estornos\/([\w-]+)\/feito$/);
    if (metodo === 'POST' && em) {
      this.sql.exec(`UPDATE corridas SET reembolsado_em=? WHERE id=? AND reembolso > 0`, iso(agora), em[1]);
      return json({ ok: true });
    }
    const mm = p.match(/^\/v2\/admin\/motoristas\/([\w-]+)\/status$/);
    if (metodo === 'POST' && mm) {
      const b = await this.corpo<{ status?: string }>(req);
      if (!['aprovado', 'bloqueado', 'pendente'].includes(String(b.status))) return erro('Status inválido.');
      this.sql.exec(`UPDATE motoristas SET status=?, online=CASE WHEN ?='aprovado' THEN online ELSE 0 END WHERE id=?`, b.status, b.status, mm[1]);
      return json({ ok: true });
    }
    const cm = p.match(/^\/v2\/admin\/clientes\/([\w-]+)\/(bloquear|desbloquear)$/);
    if (metodo === 'POST' && cm) {
      this.sql.exec(`UPDATE clientes SET bloqueado=? WHERE id=?`, cm[2] === 'bloquear' ? 1 : 0, cm[1]);
      return json({ ok: true });
    }
    const am = p.match(/^\/v2\/admin\/corridas\/([\w-]+)\/cancelar$/);
    if (metodo === 'POST' && am) {
      const c = this.corrida(am[1]);
      if (!c) return erro('Corrida não encontrada.', 404);
      if (['entregue', 'cancelado'].includes(String(c.status))) return erro('Corrida já encerrada.', 409);
      if (c.liberado_em) {
        // Já liberada ao motorista: desfaz o crédito e devolve tudo ao cliente.
        this.sql.exec(`DELETE FROM creditos WHERE corrida_id=?`, c.id);
        this.sql.exec(`UPDATE corridas SET liberado_em=NULL WHERE id=?`, c.id);
      }
      const atual = this.corrida(c.id)!;
      this.cancelar({ ...atual, status: 'admin' }, 'admin', 'admin', '❌ CORRIDA CANCELADA por você');
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
      if (!(cfg.bloqueioMin >= 10 && cfg.bloqueioMin <= 240 && cfg.passoMin >= 5 && cfg.comissaoMotoristaPct >= 0 && cfg.comissaoMotoristaPct <= 100 && cfg.raioChegadaM >= 50))
        return erro('Valores inválidos.');
      if (!Array.isArray(cfg.servicosAtivos) || cfg.servicosAtivos.some((x) => !SERVICOS.some((s) => s.id === x))) return erro('Serviços inválidos.');
      if (!Array.isArray(cfg.categoriasAtivas) || cfg.categoriasAtivas.some((x) => !CATEGORIAS.some((c) => c.id === x))) return erro('Categorias inválidas.');
      cfg.outroEnderecoLoja = !!cfg.outroEnderecoLoja;
      if (!Array.isArray(cfg.cidadesAtivas) || !cfg.cidadesAtivas.length || cfg.cidadesAtivas.some((x) => !CIDADES.some((c) => c.id === x))) return erro('Cidades inválidas.');
      this.salvarConfig(cfg);
      return json(cfg);
    }
    if (metodo === 'GET' && p === '/v2/admin/locais') return json(this.locais(true));
    const lm = p.match(/^\/v2\/admin\/locais(?:\/([\w-]+))?$/);
    if (lm && (metodo === 'POST' || metodo === 'PUT')) {
      const b = await this.corpo<{ categoria?: string; nome?: string; endereco?: string; lat?: number; lon?: number; ativo?: boolean; cidade?: string }>(req);
      const atual = lm[1] ? this.um(`SELECT * FROM locais WHERE id=?`, lm[1]) : undefined;
      if (lm[1] && !atual) return erro('Local não encontrado.', 404);
      const l = {
        categoria: String(b.categoria ?? atual?.categoria ?? ''), nome: String(b.nome ?? atual?.nome ?? '').trim(), endereco: String(b.endereco ?? atual?.endereco ?? '').trim(),
        lat: typeof b.lat === 'number' ? b.lat : Number(atual?.lat), lon: typeof b.lon === 'number' ? b.lon : Number(atual?.lon),
        ativo: b.ativo === undefined ? (atual ? Number(atual.ativo) : 1) : b.ativo ? 1 : 0,
      };
      if (!CATEGORIAS.some((c) => c.id === l.categoria)) return erro('Categoria inválida.');
      if (l.nome.length < 2) return erro('Informe o nome.');
      if (l.endereco.length < 6) return erro('Informe o endereço.');
      if (!Number.isFinite(l.lat) || !Number.isFinite(l.lon)) return erro('Marque o local no mapa.');
      if (!cidadeDe(l)) return erro('Local fora da região atendida.');
      const cidade = CIDADES.some((c) => c.id === b.cidade) ? b.cidade : ((atual?.cidade as string | undefined) ?? cidadeDe(l));
      const id = lm[1] ?? novoId(l.categoria);
      this.sql.exec(
        `INSERT INTO locais (id, categoria, nome, endereco, lat, lon, ativo, criado_em, cidade) VALUES (?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET categoria=excluded.categoria, nome=excluded.nome, endereco=excluded.endereco, lat=excluded.lat, lon=excluded.lon, ativo=excluded.ativo, cidade=excluded.cidade`,
        id, l.categoria, l.nome, l.endereco, l.lat, l.lon, l.ativo, iso(agora), cidade,
      );
      return json({ id, ...l, ativo: !!l.ativo, cidade });
    }
    if (lm?.[1] && metodo === 'DELETE') {
      this.sql.exec(`DELETE FROM locais WHERE id=?`, lm[1]);
      return json({ ok: true });
    }
    if (metodo === 'GET' && p === '/v2/admin/agenda-link') return json({ url: `${url.origin}/agenda.ics?k=${await this.chaveAgenda('')}` });
    return erro('Rota não encontrada.', 404);
  }
}

export function paginaRetorno(scheme: string, pago: boolean, id: string, gorjeta = false) {
  const link = `${scheme}://pagamento?corrida=${encodeURIComponent(id)}&status=${pago ? 'pago' : 'aguardando'}`;
  const titulo = gorjeta ? (pago ? 'Obrigado pela gorjeta!' : 'Gorjeta em processamento') : pago ? 'Pagamento confirmado!' : 'Pagamento em processamento';
  return new Response(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${titulo}</title><style>body{font-family:system-ui,sans-serif;background:#F6F7F5;color:#1E2925;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;text-align:center}
a{display:inline-block;margin-top:16px;background:#2E8A5E;color:#fff;padding:14px 24px;border-radius:14px;text-decoration:none;font-weight:700}</style></head>
<body><div><h1>${titulo}</h1><p>${gorjeta ? 'O valor vai inteiro para o motorista.' : pago ? 'O valor fica retido até você confirmar que o motorista chegou.' : 'Assim que a InfinitePay confirmar, o app mostra o pagamento.'}</p>
<a href="${link}">Voltar ao ${MARCA.nome}</a></div></body></html>`,
    { headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}
