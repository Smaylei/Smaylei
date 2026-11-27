// Delivery das lojas (vitrine MOVI): o lojista publica produtos e vende pelo app; a MOVI faz a entrega.
//
// Modelo: a loja paga só a MENSALIDADE (sem taxa por pedido). O cliente paga produtos + frete num só
// Pix/cartão pela MOVI. O valor fica RETIDO:
//   pagamento_pendente ──(pagou)──▶ aguardando_loja ──(loja aceita)──▶ aceito  [cria a corrida "delivery"]
//   ──(motorista entrega e o cliente confirma)──▶ entregue  [produtos liberados no saldo da loja; frete ao motorista]
// Loja recusa, não responde a tempo, cliente cancela antes do aceite ou nenhum motorista aceita: cancelado
// com ESTORNO (o dono devolve pelo app da InfinitePay e marca no Admin, como nas corridas).
// Saldo da loja = produtos dos pedidos entregues − repasses (Pix na chave da loja, 1x a cada saqueDias).

import type { Config } from './central';
import { cidadeDe, type CidadeId } from '../../src/data/cidades';
import { aceitaMoto, CATEGORIAS_LOJA, DIAS_MENSALIDADE, type Veiculo } from '../../src/data/servicos';
import { nomeTipoChave } from '../../src/services/pix';
import { distanciaRetaKm } from '../../src/services/preco';
import { brl, DIA, erro, iso, json, MIN, novoId, r2, type Linha } from './util';

type Ponto = { lat: number; lon: number };
type Cotacao = { valor: number; urgencia: number; km: number; minutos: number; kmDesloc: number };

/** O que o delivery usa da Central (banco, configuração, InfinitePay, preço e corridas). */
export interface BaseDelivery {
  q<T extends Linha = Linha>(consulta: string, ...args: unknown[]): T[];
  um<T extends Linha = Linha>(consulta: string, ...args: unknown[]): T | undefined;
  exec(consulta: string, ...args: unknown[]): void;
  config(): Config;
  avisar(texto: string, corridaId?: unknown): void;
  link(o: { orderNsu: string; valor: number; descricao: string; cli: Linha; origem: string; validoMin: number; itens?: { descricao: string; valor: number; qtd: number }[] }): Promise<string>;
  checar(orderNsu: string, slug: string, tx: string): Promise<{ pago: boolean; metodo: string | null }>;
  cotar(coleta: Ponto, entrega: Ponto, veiculo: Veiculo): Promise<Cotacao>;
  agoraOk(): { ok: boolean; motivo?: string };
  foraDaArea(p: Ponto): string | null;
  corrida(id: unknown): Linha | undefined;
  cancelarCorrida(c: Linha, motivo: string, por: string, cab: string): void;
  /** Pagamentos pela Pagar.me (o app paga com Pix/cartão na tela própria; sem link da InfinitePay). */
  pagarmeAtivo(): boolean;
  docs?: R2Bucket;
}

export const ESQUEMA_DELIVERY = `
CREATE TABLE IF NOT EXISTS produtos (
  id TEXT PRIMARY KEY, loja_id TEXT NOT NULL, nome TEXT NOT NULL, descricao TEXT, preco REAL NOT NULL, categoria TEXT, foto TEXT,
  ativo INTEGER NOT NULL DEFAULT 1, ordem INTEGER NOT NULL DEFAULT 0, criado_em TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS produtos_loja ON produtos(loja_id);
CREATE TABLE IF NOT EXISTS pedidos (
  id TEXT PRIMARY KEY, codigo TEXT NOT NULL, loja_id TEXT NOT NULL, cliente_id TEXT NOT NULL, corrida_id TEXT, itens TEXT NOT NULL,
  subtotal REAL NOT NULL, frete REAL NOT NULL, total REAL NOT NULL, km REAL, minutos REAL, km_desloc REAL, veiculo TEXT NOT NULL DEFAULT 'carro',
  observacao TEXT, status TEXT NOT NULL, entrega_endereco TEXT, entrega_lat REAL, entrega_lon REAL, checkout_url TEXT, slug TEXT,
  transaction_nsu TEXT, metodo TEXT, receipt_url TEXT, criado_em TEXT NOT NULL, pagamento_ate TEXT, pago_em TEXT, aceito_em TEXT,
  entregue_em TEXT, liberado_em TEXT, cancelado_em TEXT, motivo TEXT, cancelado_por TEXT, reembolso REAL NOT NULL DEFAULT 0,
  reembolsado_em TEXT, repasse_id TEXT);
CREATE INDEX IF NOT EXISTS pedidos_loja ON pedidos(loja_id, status);
CREATE INDEX IF NOT EXISTS pedidos_cliente ON pedidos(cliente_id);
CREATE TABLE IF NOT EXISTS mensalidades (
  id TEXT PRIMARY KEY, loja_id TEXT NOT NULL, valor REAL NOT NULL, dias INTEGER NOT NULL, status TEXT NOT NULL, origem TEXT NOT NULL DEFAULT 'pagamento',
  checkout_url TEXT, slug TEXT, transaction_nsu TEXT, metodo TEXT, receipt_url TEXT, criado_em TEXT NOT NULL, pago_em TEXT);
CREATE TABLE IF NOT EXISTS repasses_loja (
  id TEXT PRIMARY KEY, loja_id TEXT NOT NULL, valor REAL NOT NULL, chave_pix TEXT NOT NULL, status TEXT NOT NULL, criado_em TEXT NOT NULL,
  pago_em TEXT, motivo TEXT)
`;
export const COLUNAS_DELIVERY = [
  ...['delivery_ate TEXT', 'delivery_aberta INTEGER NOT NULL DEFAULT 0', 'delivery_desc TEXT', 'delivery_categoria TEXT', 'pedido_minimo REAL NOT NULL DEFAULT 0',
    'preparo_min INTEGER NOT NULL DEFAULT 20', 'pix_repasse TEXT'].map((c) => `ALTER TABLE clientes ADD COLUMN ${c}`),
  'ALTER TABLE corridas ADD COLUMN pedido_id TEXT',
  'ALTER TABLE pedidos ADD COLUMN urgencia REAL NOT NULL DEFAULT 0',
  // Pagar.me: produtos direto para a loja (split), cobrança e estorno automático
  ...['repasse_direto INTEGER NOT NULL DEFAULT 0', 'cobranca_id TEXT', 'estorno_tentado_em TEXT', 'estorno_erro TEXT'].map((c) => `ALTER TABLE pedidos ADD COLUMN ${c}`),
  'ALTER TABLE mensalidades ADD COLUMN cobranca_id TEXT',
  'ALTER TABLE pedidos ADD COLUMN taxa_pagamento REAL NOT NULL DEFAULT 0', // taxa do Pix/cartão paga pelo cliente por cima
];

/** Chave Pix dos repasses da loja: a escolhida (com tipo) ou, se nunca trocou, o CNPJ/CPF. */
function chavePixLoja(loja: Linha): { pix: string; pixTipo: string } {
  if (loja.pix_repasse) return { pix: String(loja.pix_repasse), pixTipo: String(loja.pix_tipo ?? '') || 'chave' };
  return loja.cnpj ? { pix: String(loja.cnpj), pixTipo: 'cnpj' } : { pix: String(loja.cpf), pixTipo: 'cpf' };
}

const ROTULO_PEDIDO: Record<string, string> = {
  pagamento_pendente: 'Aguardando pagamento',
  aguardando_loja: 'Aguardando a loja aceitar',
  aceito: 'Loja preparando',
  entregue: 'Entregue',
  cancelado: 'Cancelado',
};
const MOTIVO: Record<string, string> = {
  nao_pago: 'Pagamento não concluído',
  loja_recusou: 'A loja recusou o pedido',
  loja_nao_respondeu: 'A loja não respondeu a tempo',
  cliente_cancelou: 'Você cancelou',
  sem_motorista: 'Nenhum motorista disponível',
  admin: 'Cancelado pelo suporte',
  substituido: 'Substituído por outro pedido',
};
type Item = { produtoId: string; nome: string; preco: number; qtd: number };
/** Muda quando a foto muda (o app usa no endereço da imagem para não mostrar a antiga do cache). */
const versao = (chave: unknown) => (chave ? String(chave).split('-').pop()?.replace('.jpg', '') ?? '1' : null);
const MAX_PRODUTOS = 300;

export class Delivery {
  constructor(private b: BaseDelivery) {}

  private get cfg() {
    return this.b.config();
  }
  liberado() {
    return this.cfg.servicosAtivos.includes('delivery');
  }
  private pedido(id: unknown) {
    return this.b.um(`SELECT * FROM pedidos WHERE id=?`, id);
  }

  // ---------- visões ----------
  private vitrineAtiva(l: Linha, agora = Date.now()) {
    return l.status === 'aprovado' && !!l.delivery_ate && Date.parse(String(l.delivery_ate)) > agora;
  }
  private lojaPublica(l: Linha, de?: Ponto) {
    const produtos = Number(this.b.um(`SELECT COUNT(*) AS n FROM produtos WHERE loja_id=? AND ativo=1`, l.id)?.n ?? 0);
    return {
      id: l.id, nome: l.loja_nome, categoria: l.delivery_categoria ?? 'mercado', descricao: l.delivery_desc ?? '', temFoto: !!l.foto, fotoV: versao(l.foto),
      aberta: !!l.delivery_aberta, pedidoMinimo: Number(l.pedido_minimo ?? 0), preparoMin: Number(l.preparo_min ?? 20),
      endereco: String(l.endereco ?? '').split(/, (Guaramirim|Jaraguá do Sul|Schroeder|Massaranduba|Joinville)/)[0], lat: l.lat, lon: l.lon,
      cidade: cidadeDe({ lat: Number(l.lat), lon: Number(l.lon) }), produtos,
      distanciaKm: de ? r2(distanciaRetaKm(de.lat, de.lon, Number(l.lat), Number(l.lon)) * 1.3) : null,
    };
  }
  private produtoPublico(p: Linha) {
    return { id: p.id, nome: p.nome, descricao: p.descricao ?? '', preco: Number(p.preco), categoria: p.categoria ?? '', temFoto: !!p.foto, fotoV: versao(p.foto), ativo: !!p.ativo, ordem: Number(p.ordem ?? 0) };
  }
  private motoristaDaCorrida(corridaId: unknown) {
    const c = corridaId ? this.b.corrida(corridaId) : undefined;
    const m = c?.motorista_id ? this.b.um(`SELECT nome, placa, carro, cor, veiculo FROM motoristas WHERE id=?`, c.motorista_id) : undefined;
    return {
      corridaStatus: c?.status ?? null,
      motorista: m ? { nome: String(m.nome).split(' ')[0], placa: m.placa, carro: m.carro, cor: m.cor, veiculo: m.veiculo ?? 'carro' } : null,
    };
  }
  private pedidoView(p: Linha, para: 'cliente' | 'loja' | 'admin') {
    const loja = this.b.um(`SELECT loja_nome, telefone, foto FROM clientes WHERE id=?`, p.loja_id);
    const cli = this.b.um(`SELECT nome, telefone FROM clientes WHERE id=?`, p.cliente_id);
    return {
      id: p.id, codigo: p.codigo, status: p.status, rotulo: ROTULO_PEDIDO[String(p.status)] ?? p.status,
      motivo: p.motivo ? (MOTIVO[String(p.motivo)] ?? p.motivo) : null,
      loja: { id: p.loja_id, nome: loja?.loja_nome ?? '(loja excluída)', temFoto: !!loja?.foto },
      cliente: para === 'cliente' ? null : { nome: para === 'admin' ? (cli?.nome ?? '(conta excluída)') : String(cli?.nome ?? 'Cliente').split(' ')[0], telefone: para === 'admin' ? (cli?.telefone ?? null) : null },
      itens: JSON.parse(String(p.itens)) as Item[], subtotal: Number(p.subtotal), frete: Number(p.frete), total: Number(p.total), veiculo: p.veiculo,
      observacao: p.observacao, entregaEndereco: para === 'loja' ? null : p.entrega_endereco,
      checkoutUrl: para === 'cliente' && p.status === 'pagamento_pendente' ? p.checkout_url : null, pagamentoAte: p.pagamento_ate, metodo: p.metodo,
      criadoEm: p.criado_em, pagoEm: p.pago_em, aceitoEm: p.aceito_em, entregueEm: p.entregue_em, canceladoEm: p.cancelado_em,
      liberadoEm: p.liberado_em, reembolso: Number(p.reembolso ?? 0), reembolsadoEm: p.reembolsado_em, repasseDireto: p.repasse_direto === 1,
      taxaPagamento: Number(p.taxa_pagamento ?? 0),
      aceiteAte: p.status === 'aguardando_loja' && p.pago_em ? iso(Date.parse(String(p.pago_em)) + this.cfg.deliveryAceiteMin * MIN) : null,
      corridaId: p.corrida_id, ...this.motoristaDaCorrida(p.corrida_id),
    };
  }

  saldoLoja(lojaId: unknown) {
    const n = (sql: string, ...a: unknown[]) => Number(this.b.um(sql, ...a)?.n ?? 0);
    const vendido = n(`SELECT COALESCE(SUM(subtotal),0) AS n FROM pedidos WHERE loja_id=? AND liberado_em IS NOT NULL AND repasse_direto=0`, lojaId);
    const direto = n(`SELECT COALESCE(SUM(subtotal),0) AS n FROM pedidos WHERE loja_id=? AND liberado_em IS NOT NULL AND repasse_direto=1`, lojaId);
    const repassado = n(`SELECT COALESCE(SUM(valor),0) AS n FROM repasses_loja WHERE loja_id=? AND status IN ('solicitado','pago')`, lojaId);
    const emAndamento = n(`SELECT COALESCE(SUM(subtotal),0) AS n FROM pedidos WHERE loja_id=? AND status IN ('aguardando_loja','aceito')`, lojaId);
    const ultimo = this.b.um<{ criado_em: string }>(`SELECT criado_em FROM repasses_loja WHERE loja_id=? AND status IN ('solicitado','pago') ORDER BY criado_em DESC LIMIT 1`, lojaId);
    const proximo = ultimo ? Date.parse(ultimo.criado_em) + this.cfg.saqueDias * DIA : 0;
    return { disponivel: r2(vendido - repassado), emAndamento: r2(emAndamento), totalVendido: r2(vendido + direto), recebidoDireto: r2(direto), proximoRepasseEm: proximo > Date.now() ? iso(proximo) : null };
  }

  /** Motivo para não excluir a conta (pedidos em aberto, saldo ou estorno pendente). */
  bloqueiaExclusao(id: string, ehLoja: boolean): string | null {
    const campo = ehLoja ? 'loja_id' : 'cliente_id';
    if (this.b.um(`SELECT id FROM pedidos WHERE ${campo}=? AND status IN ('aguardando_loja','aceito')`, id)) return 'Há pedidos do delivery em andamento nesta conta. Conclua ou cancele antes de excluir.';
    if (this.b.um(`SELECT id FROM pedidos WHERE ${campo}=? AND reembolso > 0 AND reembolsado_em IS NULL`, id)) return 'Há estorno pendente de pedido do delivery nesta conta. Faça o estorno antes de excluir.';
    if (ehLoja) {
      if (this.b.um(`SELECT id FROM repasses_loja WHERE loja_id=? AND status='solicitado'`, id)) return 'Há um repasse pendente para esta loja. Pague ou recuse antes de excluir.';
      const s = this.saldoLoja(id).disponivel;
      if (s > 0) return `Esta loja tem ${brl(s)} de vendas a receber. Faça o repasse antes de excluir.`;
    }
    return null;
  }

  // ---------- ciclo do pedido ----------
  /** Cancela o pedido; `reembolso` é a parte de produtos + frete (a taxa do Pix/cartão paga pelo cliente volta junto). */
  private cancelarPedido(p: Linha, motivo: string, por: string, reembolso: number, cab: string) {
    const agora = iso(Date.now());
    if (p.pago_em && reembolso > 0) reembolso += Number(p.taxa_pagamento ?? 0);
    this.b.exec(`UPDATE pedidos SET status='cancelado', motivo=?, cancelado_por=?, cancelado_em=?, reembolso=? WHERE id=?`, motivo, por, agora, r2(reembolso), p.id);
    if (p.pago_em) this.b.avisar(this.textoPedido(this.pedido(p.id)!, cab), p.corrida_id);
  }
  private textoPedido(p: Linha, cab: string) {
    const loja = this.b.um(`SELECT loja_nome FROM clientes WHERE id=?`, p.loja_id);
    const cli = this.b.um(`SELECT nome FROM clientes WHERE id=?`, p.cliente_id);
    const itens = (JSON.parse(String(p.itens)) as Item[]).map((i) => `${i.qtd}× ${i.nome}`).join(', ');
    return [
      cab, `🛍️ Pedido #${p.codigo} · ${loja?.loja_nome ?? 'loja'}`, `Cliente: ${cli?.nome ?? '-'}`, `Itens: ${itens}`,
      `Produtos ${brl(Number(p.subtotal))} + frete ${brl(Number(p.frete))} = ${brl(Number(p.total))}${Number(p.taxa_pagamento) > 0 ? ` (+ taxa ${brl(Number(p.taxa_pagamento))} paga pelo cliente)` : ''}${p.metodo ? ` (${p.metodo === 'pix' ? 'Pix' : 'cartão'})` : ''}`,
      Number(p.reembolso) > 0 ? `⚠️ ESTORNAR ${brl(Number(p.reembolso))} ao cliente pelo app da InfinitePay` : '',
    ].filter(Boolean).join('\n');
  }

  /** Corrida do pedido foi liberada (entregue): produtos vão para o saldo da loja. */
  entregue(pedidoId: unknown) {
    const p = this.pedido(pedidoId);
    if (!p || p.liberado_em || p.status === 'cancelado') return;
    const agora = iso(Date.now());
    this.b.exec(`UPDATE pedidos SET status='entregue', entregue_em=?, liberado_em=? WHERE id=?`, agora, agora, p.id);
  }
  /** Corrida do pedido cancelada: o pedido também, com estorno de tudo menos a taxa de deslocamento. */
  corridaCancelada(pedidoId: unknown, taxa: number, cab: string) {
    const p = this.pedido(pedidoId);
    if (!p || p.status === 'cancelado') return;
    if (p.liberado_em && !p.repasse_id) this.b.exec(`UPDATE pedidos SET liberado_em=NULL WHERE id=?`, p.id);
    this.b.exec(`UPDATE corridas SET reembolso=0 WHERE pedido_id=?`, p.id); // o estorno fica no pedido
    const motivo = String(this.b.corrida(p.corrida_id)?.motivo ?? 'admin');
    this.cancelarPedido(p, motivo, 'sistema', r2(Number(p.total) - taxa), cab);
  }

  manutencao() {
    const agora = Date.now();
    this.b.exec(`UPDATE pedidos SET status='cancelado', motivo='nao_pago', cancelado_por='sistema', cancelado_em=? WHERE status='pagamento_pendente' AND pagamento_ate < ?`, iso(agora), iso(agora));
    const limite = iso(agora - this.cfg.deliveryAceiteMin * MIN);
    for (const p of this.b.q(`SELECT * FROM pedidos WHERE status='aguardando_loja' AND pago_em < ?`, limite))
      this.cancelarPedido(p, 'loja_nao_respondeu', 'sistema', Number(p.total), `⏰ LOJA NÃO RESPONDEU em ${this.cfg.deliveryAceiteMin} min — pedido cancelado`);
  }

  // ---------- pagamentos (InfinitePay) ----------
  async confirmar(id: string, slug: string, tx: string, receiptUrl?: string | null) {
    if (id.startsWith('mens-')) return this.confirmarMensalidade(id, slug, tx, receiptUrl);
    const p = this.pedido(id);
    if (!p || p.pago_em) return p ?? null;
    const r = await this.b.checar(id, slug, tx);
    if (!r.pago || this.pedido(id)?.pago_em) return this.pedido(id) ?? null;
    return this.aplicarPago(id, r.metodo, { slug, tx, receiptUrl });
  }

  /** Pagamento confirmado (InfinitePay ou Pagar.me). `direto`: os produtos já foram para a loja pelo split. */
  aplicarPago(id: string, metodo: string | null, extra: { slug?: string; tx?: string; receiptUrl?: string | null; cobrancaId?: string; direto?: boolean; taxa?: number } = {}) {
    if (id.startsWith('mens-')) return this.aplicarMensalidade(id, metodo, extra);
    const p = this.pedido(id);
    if (!p || p.pago_em) return p ?? null;
    const agora = iso(Date.now());
    this.b.exec(
      `UPDATE pedidos SET pago_em=?, metodo=?, slug=?, transaction_nsu=?, receipt_url=?, cobranca_id=?, repasse_direto=?, taxa_pagamento=? WHERE id=?`,
      agora, metodo, extra.slug ?? null, extra.tx ?? null, extra.receiptUrl ?? null, extra.cobrancaId ?? null, extra.direto ? 1 : 0, extra.taxa ?? 0, id,
    );
    if (p.status === 'pagamento_pendente') {
      this.b.exec(`UPDATE pedidos SET status='aguardando_loja' WHERE id=?`, id);
      this.b.avisar(this.textoPedido(this.pedido(id)!, `💰 PEDIDO PAGO — aguardando a loja aceitar (até ${this.cfg.deliveryAceiteMin} min)`));
    } else {
      this.b.exec(`UPDATE pedidos SET reembolso=total + taxa_pagamento WHERE id=?`, id);
      this.b.avisar(this.textoPedido(this.pedido(id)!, '⚠️ PEDIDO PAGO APÓS O PRAZO — já estava cancelado'));
    }
    return this.pedido(id)!;
  }
  private async confirmarMensalidade(id: string, slug: string, tx: string, receiptUrl?: string | null) {
    const m = this.b.um(`SELECT * FROM mensalidades WHERE id=?`, id);
    if (!m || m.status === 'paga') return m ?? null;
    const r = await this.b.checar(id, slug, tx);
    if (!r.pago || this.b.um(`SELECT status FROM mensalidades WHERE id=?`, id)?.status === 'paga') return this.b.um(`SELECT * FROM mensalidades WHERE id=?`, id) ?? null;
    return this.aplicarMensalidade(id, r.metodo, { slug, tx, receiptUrl });
  }
  private aplicarMensalidade(id: string, metodo: string | null, extra: { slug?: string; tx?: string; receiptUrl?: string | null; cobrancaId?: string }) {
    const m = this.b.um(`SELECT * FROM mensalidades WHERE id=?`, id);
    if (!m || m.status === 'paga') return m ?? null;
    const r = { metodo };
    this.b.exec(
      `UPDATE mensalidades SET status='paga', pago_em=?, metodo=?, slug=?, transaction_nsu=?, receipt_url=?, cobranca_id=? WHERE id=?`,
      iso(Date.now()), metodo, extra.slug ?? null, extra.tx ?? null, extra.receiptUrl ?? null, extra.cobrancaId ?? null, id,
    );
    const ate = this.estender(m.loja_id, Number(m.dias));
    const loja = this.b.um(`SELECT loja_nome FROM clientes WHERE id=?`, m.loja_id);
    this.b.avisar(`🏪 MENSALIDADE DO DELIVERY paga: ${loja?.loja_nome ?? 'loja'} · ${brl(Number(m.valor))} (${r.metodo === 'pix' ? 'Pix' : 'cartão'}) — vitrine ativa até ${new Date(ate).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`);
    return this.b.um(`SELECT * FROM mensalidades WHERE id=?`, id)!;
  }
  /** Soma dias à vitrine (a partir de hoje ou do vencimento, o que for depois). */
  private estender(lojaId: unknown, dias: number) {
    const atual = Date.parse(String(this.b.um(`SELECT delivery_ate FROM clientes WHERE id=?`, lojaId)?.delivery_ate ?? '')) || 0;
    const ate = Math.max(Date.now(), atual) + dias * DIA;
    this.b.exec(`UPDATE clientes SET delivery_ate=? WHERE id=?`, iso(ate), lojaId);
    return ate;
  }

  // ---------- rotas públicas (fotos da vitrine) ----------
  async publicas(p: string, metodo: string): Promise<Response | null> {
    const fm = p.match(/^\/v2\/(lojas|produtos)\/([\w-]+)\/foto$/);
    if (metodo !== 'GET' || !fm) return null;
    const chave = fm[1] === 'lojas'
      ? this.b.um(`SELECT foto FROM clientes WHERE id=? AND tipo='lojista'`, fm[2])?.foto
      : this.b.um(`SELECT foto FROM produtos WHERE id=?`, fm[2])?.foto;
    if (!chave || !this.b.docs) return erro('Sem foto.', 404);
    const o = await this.b.docs.get(String(chave));
    return o ? new Response(o.body, { headers: { 'content-type': o.httpMetadata?.contentType ?? 'image/jpeg', 'cache-control': 'public, max-age=300', 'access-control-allow-origin': '*' } }) : erro('Sem foto.', 404);
  }

  // ---------- cliente ----------
  async cliente(req: Request, url: URL, cli: Linha, p: string, metodo: string): Promise<Response | null> {
    if (!p.startsWith('/v2/lojas') && !p.startsWith('/v2/pedidos')) return null;
    const cfg = this.cfg;
    const agora = Date.now();
    const casa = { lat: Number(cli.lat), lon: Number(cli.lon) };
    if (!this.liberado() && !(metodo === 'GET' && p.startsWith('/v2/pedidos'))) return erro('O Delivery da MOVI ainda não está disponível. Em breve!', 403);

    if (metodo === 'GET' && p === '/v2/lojas') {
      const lojas = this.b
        .q(`SELECT * FROM clientes WHERE tipo='lojista' AND status='aprovado' AND delivery_ate > ?`, iso(agora))
        .filter((l) => {
          const c = cidadeDe({ lat: Number(l.lat), lon: Number(l.lon) });
          return !!c && cfg.cidadesAtivas.includes(c as CidadeId);
        })
        .map((l) => this.lojaPublica(l, casa))
        .filter((l) => l.produtos > 0)
        .sort((a, b) => Number(b.aberta) - Number(a.aberta) || (a.distanciaKm ?? 0) - (b.distanciaKm ?? 0));
      return json({ lojas, entrega: this.b.agoraOk(), moto: aceitaMoto('delivery', cfg) });
    }
    const lm = p.match(/^\/v2\/lojas\/([\w-]+)$/);
    if (metodo === 'GET' && lm) {
      const l = this.b.um(`SELECT * FROM clientes WHERE id=? AND tipo='lojista'`, lm[1]);
      if (!l || !this.vitrineAtiva(l, agora)) return erro('Loja indisponível no momento.', 404);
      const produtos = this.b.q(`SELECT * FROM produtos WHERE loja_id=? AND ativo=1 ORDER BY categoria, ordem, nome`, l.id).map((x) => this.produtoPublico(x));
      return json({ loja: this.lojaPublica(l, casa), produtos, entrega: this.b.agoraOk(), moto: aceitaMoto('delivery', cfg) });
    }
    if (metodo === 'POST' && (p === '/v2/pedidos/cotar' || p === '/v2/pedidos')) {
      const b = await req.json().catch(() => ({})) as { lojaId?: string; itens?: { produtoId?: string; qtd?: number }[]; observacao?: string; veiculo?: string };
      const l = this.b.um(`SELECT * FROM clientes WHERE id=? AND tipo='lojista'`, b.lojaId);
      if (!l || !this.vitrineAtiva(l, agora)) return erro('Loja indisponível no momento.', 404);
      if (!l.delivery_aberta) return erro(`${l.loja_nome} está fechada agora.`, 409);
      const fora = this.b.foraDaArea(casa);
      if (fora) return erro(`Seu endereço: ${fora}.`);
      const lojaPt = { lat: Number(l.lat), lon: Number(l.lon) };
      if (distanciaRetaKm(lojaPt.lat, lojaPt.lon, casa.lat, casa.lon) < 0.05) return erro('Seu endereço é o mesmo da loja. Retire no balcão.');
      const veiculo: Veiculo = b.veiculo === 'moto' ? 'moto' : 'carro';
      if (veiculo === 'moto' && !aceitaMoto('delivery', cfg)) return erro('Entrega de moto ainda não está disponível.');
      const disp = this.b.agoraOk();
      const cot = await this.b.cotar(lojaPt, casa, veiculo);
      if (p === '/v2/pedidos/cotar') return json({ frete: cot.valor, km: cot.km, minutos: cot.minutos, entrega: disp });
      if (cli.bloqueado) return erro('Cadastro bloqueado. Fale com o suporte.', 403);
      if (!disp.ok) return erro(`Entrega indisponível agora: ${disp.motivo ?? ''}`.trim(), 409);
      // Itens: preço sempre do banco (nunca do app).
      const pedidos = (Array.isArray(b.itens) ? b.itens : []).filter((i) => i?.produtoId);
      if (!pedidos.length) return erro('Escolha pelo menos um produto.');
      if (pedidos.length > 50) return erro('Até 50 produtos diferentes por pedido.');
      const itens: Item[] = [];
      for (const i of pedidos) {
        const qtd = Math.round(Number(i.qtd));
        if (!(qtd >= 1 && qtd <= 99)) return erro('Quantidade inválida.');
        const pr = this.b.um(`SELECT * FROM produtos WHERE id=? AND loja_id=? AND ativo=1`, i.produtoId, l.id);
        if (!pr) return erro('Um dos produtos não está mais disponível. Atualize a vitrine.', 409);
        const ja = itens.find((x) => x.produtoId === pr.id);
        if (ja) ja.qtd += qtd;
        else itens.push({ produtoId: String(pr.id), nome: String(pr.nome), preco: Number(pr.preco), qtd });
      }
      const subtotal = r2(itens.reduce((s, i) => s + i.preco * i.qtd, 0));
      if (subtotal < Number(l.pedido_minimo ?? 0)) return erro(`O pedido mínimo de ${l.loja_nome} é ${brl(Number(l.pedido_minimo))}.`);
      const total = r2(subtotal + cot.valor);
      this.b.exec(`UPDATE pedidos SET status='cancelado', motivo='substituido', cancelado_em=? WHERE cliente_id=? AND status='pagamento_pendente'`, iso(agora), cli.id);
      const id = novoId('ped');
      const codigo = crypto.randomUUID().replace(/-/g, '').slice(0, 4).toUpperCase();
      const observacao = String(b.observacao ?? '').trim().slice(0, 300) || null;
      this.b.exec(
        `INSERT INTO pedidos (id, codigo, loja_id, cliente_id, itens, subtotal, frete, total, km, minutos, km_desloc, veiculo, observacao, status,
           entrega_endereco, entrega_lat, entrega_lon, criado_em, pagamento_ate, urgencia) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'pagamento_pendente', ?,?,?,?,?,?)`,
        id, codigo, l.id, cli.id, JSON.stringify(itens), subtotal, cot.valor, total, cot.km, cot.minutos, cot.kmDesloc, veiculo, observacao,
        cli.endereco, casa.lat, casa.lon, iso(agora), iso(agora + cfg.esperaPagamentoMin * MIN), cot.urgencia,
      );
      if (this.b.pagarmeAtivo()) return json(this.pedidoView(this.pedido(id)!, 'cliente')); // paga na tela de pagamento do app
      try {
        const urlPg = await this.b.link({
          orderNsu: id, valor: total, descricao: `Pedido #${codigo} - ${l.loja_nome}`, cli, origem: url.origin, validoMin: cfg.esperaPagamentoMin + 5,
          itens: [...itens.map((i) => ({ descricao: i.nome, valor: i.preco, qtd: i.qtd })), { descricao: 'Entrega MOVI', valor: cot.valor, qtd: 1 }],
        });
        this.b.exec(`UPDATE pedidos SET checkout_url=? WHERE id=?`, urlPg, id);
      } catch (e) {
        this.b.exec(`UPDATE pedidos SET status='cancelado', motivo='erro_pagamento', cancelado_em=? WHERE id=?`, iso(agora), id);
        return erro((e as Error).message, 502);
      }
      return json(this.pedidoView(this.pedido(id)!, 'cliente'));
    }
    if (metodo === 'GET' && (p === '/v2/pedidos' || p === '/v2/pedidos/ativos')) {
      const lista = p === '/v2/pedidos'
        ? this.b.q(`SELECT * FROM pedidos WHERE cliente_id=? AND pago_em IS NOT NULL ORDER BY criado_em DESC LIMIT 30`, cli.id)
        : this.b.q(`SELECT * FROM pedidos WHERE cliente_id=? AND (status IN ('aguardando_loja','aceito') OR (pago_em IS NOT NULL AND COALESCE(entregue_em, cancelado_em) > ?)) ORDER BY criado_em DESC`, cli.id, iso(agora - 2 * 60 * MIN));
      return json(lista.map((x) => this.pedidoView(x, 'cliente')));
    }
    const pm = p.match(/^\/v2\/pedidos\/([\w-]+)(\/cancelar)?$/);
    if (pm) {
      const ped = this.b.um(`SELECT * FROM pedidos WHERE id=? AND cliente_id=?`, pm[1], cli.id);
      if (!ped) return erro('Pedido não encontrado.', 404);
      if (metodo === 'GET' && !pm[2]) return json(this.pedidoView(ped, 'cliente'));
      if (metodo === 'POST' && pm[2]) {
        if (ped.status === 'pagamento_pendente') this.b.exec(`UPDATE pedidos SET status='cancelado', motivo='cliente_cancelou', cancelado_por='cliente', cancelado_em=? WHERE id=?`, iso(agora), ped.id);
        else if (ped.status === 'aguardando_loja') this.cancelarPedido(ped, 'cliente_cancelou', 'cliente', Number(ped.total), '❌ PEDIDO CANCELADO pelo cliente (antes da loja aceitar)');
        else return erro('A loja já aceitou o pedido. Para cancelar, fale com o suporte pelo chat da entrega.', 409);
        return json(this.pedidoView(this.pedido(ped.id)!, 'cliente'));
      }
    }
    return erro('Rota não encontrada.', 404);
  }

  // ---------- lojista ----------
  async loja(req: Request, url: URL, loja: Linha, p: string, metodo: string): Promise<Response | null> {
    if (!p.startsWith('/v2/loja')) return null;
    const cfg = this.cfg;
    const agora = Date.now();
    const corpo = async <T>() => ((await req.json().catch(() => ({}))) ?? {}) as T;
    const aprovada = loja.status === 'aprovado';

    if (metodo === 'GET' && p === '/v2/loja') {
      const n = (sql: string) => Number(this.b.um(sql, loja.id)?.n ?? 0);
      return json({
        liberado: this.liberado(), aprovada, mensalidade: cfg.deliveryMensalidade, diasMensalidade: DIAS_MENSALIDADE,
        ativaAte: loja.delivery_ate ?? null, ativa: this.vitrineAtiva(loja, agora), aberta: !!loja.delivery_aberta,
        descricao: loja.delivery_desc ?? '', categoria: loja.delivery_categoria ?? 'mercado', pedidoMinimo: Number(loja.pedido_minimo ?? 0),
        preparoMin: Number(loja.preparo_min ?? 20), ...chavePixLoja(loja), temFoto: !!loja.foto, fotoV: versao(loja.foto), id: loja.id, aceiteMin: cfg.deliveryAceiteMin,
        produtos: n(`SELECT COUNT(*) AS n FROM produtos WHERE loja_id=?`), produtosAtivos: n(`SELECT COUNT(*) AS n FROM produtos WHERE loja_id=? AND ativo=1`),
        pedidosNovos: n(`SELECT COUNT(*) AS n FROM pedidos WHERE loja_id=? AND status='aguardando_loja'`),
        pedidosAndamento: n(`SELECT COUNT(*) AS n FROM pedidos WHERE loja_id=? AND status='aceito'`),
        saldo: this.saldoLoja(loja.id),
        gateway: this.b.pagarmeAtivo() ? 'pagarme' : 'infinitepay',
        recebedor: { temConta: !!loja.pagarme_recebedor, status: loja.pagarme_status ?? null, ativo: !!loja.pagarme_recebedor && loja.pagarme_status === 'active' },
      });
    }
    if (metodo === 'PUT' && p === '/v2/loja') {
      const b = await corpo<{ descricao?: string; categoria?: string; pedidoMinimo?: number; preparoMin?: number; pix?: string; aberta?: boolean }>();
      const desc = b.descricao !== undefined ? String(b.descricao).trim().slice(0, 200) : loja.delivery_desc;
      const cat = b.categoria !== undefined ? String(b.categoria) : (loja.delivery_categoria ?? 'mercado');
      if (!CATEGORIAS_LOJA.some((c) => c.id === cat)) return erro('Tipo de loja inválido.');
      const minimo = b.pedidoMinimo !== undefined ? r2(Number(b.pedidoMinimo)) : Number(loja.pedido_minimo ?? 0);
      if (!(minimo >= 0 && minimo <= 1000)) return erro('Pedido mínimo inválido.');
      const preparo = b.preparoMin !== undefined ? Math.round(Number(b.preparoMin)) : Number(loja.preparo_min ?? 20);
      if (!(preparo >= 5 && preparo <= 180)) return erro('Tempo de preparo entre 5 e 180 minutos.');
      // A chave Pix só muda pela rota própria (PUT /v2/eu/pix), que pede a senha e avisa o Admin.
      if (b.pix !== undefined && String(b.pix).trim() !== chavePixLoja(loja).pix) return erro('Para trocar a chave Pix, toque em "Trocar chave Pix" (pede a sua senha).', 409);
      const pix = loja.pix_repasse;
      const aberta = b.aberta !== undefined ? (b.aberta ? 1 : 0) : Number(loja.delivery_aberta ?? 0);
      if (aberta && !aprovada) return erro('A loja precisa estar aprovada para abrir a vitrine.', 403);
      this.b.exec(`UPDATE clientes SET delivery_desc=?, delivery_categoria=?, pedido_minimo=?, preparo_min=?, pix_repasse=?, delivery_aberta=? WHERE id=?`, desc ?? null, cat, minimo, preparo, pix ?? null, aberta, loja.id);
      return json({ ok: true });
    }
    if (metodo === 'POST' && p === '/v2/loja/mensalidade') {
      if (!aprovada) return erro('O cadastro da loja ainda está em análise.', 403);
      if (!this.liberado()) return erro('O Delivery da MOVI ainda não foi liberado. Você já pode cadastrar os seus produtos.', 403);
      this.b.exec(`UPDATE mensalidades SET status='cancelada' WHERE loja_id=? AND status='pendente'`, loja.id);
      const id = novoId('mens');
      const valor = r2(cfg.deliveryMensalidade);
      if (this.b.pagarmeAtivo()) {
        this.b.exec(`INSERT INTO mensalidades (id, loja_id, valor, dias, status, criado_em) VALUES (?,?,?,?, 'pendente', ?)`, id, loja.id, valor, DIAS_MENSALIDADE, iso(agora));
        return json({ id, valor, checkoutUrl: null, status: 'pendente' });
      }
      let checkoutUrl: string;
      try {
        checkoutUrl = await this.b.link({ orderNsu: id, valor, descricao: `Vitrine MOVI Delivery - ${DIAS_MENSALIDADE} dias - ${loja.loja_nome}`, cli: loja, origem: url.origin, validoMin: 60 });
      } catch (e) {
        return erro((e as Error).message, 502);
      }
      this.b.exec(`INSERT INTO mensalidades (id, loja_id, valor, dias, status, checkout_url, criado_em) VALUES (?,?,?,?, 'pendente', ?,?)`, id, loja.id, valor, DIAS_MENSALIDADE, checkoutUrl, iso(agora));
      return json({ id, valor, checkoutUrl, status: 'pendente' });
    }
    const mm = p.match(/^\/v2\/loja\/mensalidades\/([\w-]+)$/);
    if (metodo === 'GET' && mm) {
      const m = this.b.um(`SELECT id, valor, status, checkout_url AS checkoutUrl, pago_em AS pagoEm FROM mensalidades WHERE id=? AND loja_id=?`, mm[1], loja.id);
      return m ? json(m) : erro('Mensalidade não encontrada.', 404);
    }

    // Produtos
    if (metodo === 'GET' && p === '/v2/loja/produtos')
      return json(this.b.q(`SELECT * FROM produtos WHERE loja_id=? ORDER BY categoria, ordem, nome`, loja.id).map((x) => this.produtoPublico(x)));
    const prm = p.match(/^\/v2\/loja\/produtos(?:\/([\w-]+))?$/);
    if (prm && (metodo === 'POST' || metodo === 'PUT' || metodo === 'DELETE')) {
      const atual = prm[1] ? this.b.um(`SELECT * FROM produtos WHERE id=? AND loja_id=?`, prm[1], loja.id) : undefined;
      if (prm[1] && !atual) return erro('Produto não encontrado.', 404);
      if (metodo === 'DELETE') {
        if (!atual) return erro('Produto não encontrado.', 404);
        this.b.exec(`DELETE FROM produtos WHERE id=?`, atual.id);
        if (atual.foto && this.b.docs) await this.b.docs.delete(String(atual.foto)).catch(() => {});
        return json({ ok: true });
      }
      if (!atual && Number(this.b.um(`SELECT COUNT(*) AS n FROM produtos WHERE loja_id=?`, loja.id)?.n ?? 0) >= MAX_PRODUTOS) return erro(`Limite de ${MAX_PRODUTOS} produtos por loja.`);
      const b = await corpo<{ nome?: string; descricao?: string; preco?: number; categoria?: string; foto?: string | null; ativo?: boolean; ordem?: number }>();
      const nome = String(b.nome ?? atual?.nome ?? '').trim().slice(0, 80);
      if (nome.length < 2) return erro('Informe o nome do produto.');
      const preco = r2(Number(b.preco ?? atual?.preco));
      if (!(preco >= 0.5 && preco <= 10000)) return erro('Preço entre R$ 0,50 e R$ 10.000,00.');
      const descricao = String(b.descricao ?? atual?.descricao ?? '').trim().slice(0, 300) || null;
      const categoria = String(b.categoria ?? atual?.categoria ?? '').trim().slice(0, 40) || null;
      let foto = atual?.foto ?? null;
      if (b.foto !== undefined) {
        // Só fotos enviadas por esta loja (nunca documentos de outras contas).
        if (b.foto && !String(b.foto).startsWith(`cliente/${loja.id}/produto-`)) return erro('Foto inválida.');
        if (foto && foto !== b.foto && this.b.docs) await this.b.docs.delete(String(foto)).catch(() => {});
        foto = b.foto || null;
      }
      const ativo = b.ativo !== undefined ? (b.ativo ? 1 : 0) : Number(atual?.ativo ?? 1);
      const ordem = Math.round(Number(b.ordem ?? atual?.ordem ?? 0)) || 0;
      if (atual) this.b.exec(`UPDATE produtos SET nome=?, descricao=?, preco=?, categoria=?, foto=?, ativo=?, ordem=? WHERE id=?`, nome, descricao, preco, categoria, foto, ativo, ordem, atual.id);
      const id = atual ? String(atual.id) : novoId('prod');
      if (!atual) this.b.exec(`INSERT INTO produtos (id, loja_id, nome, descricao, preco, categoria, foto, ativo, ordem, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?)`, id, loja.id, nome, descricao, preco, categoria, foto, ativo, ordem, iso(agora));
      return json(this.produtoPublico(this.b.um(`SELECT * FROM produtos WHERE id=?`, id)!));
    }

    // Pedidos recebidos
    if (metodo === 'GET' && p === '/v2/loja/pedidos') {
      const lista = this.b.q(
        `SELECT * FROM pedidos WHERE loja_id=? AND (status IN ('aguardando_loja','aceito') OR (pago_em IS NOT NULL AND COALESCE(entregue_em, cancelado_em) > ?))
         ORDER BY CASE status WHEN 'aguardando_loja' THEN 0 WHEN 'aceito' THEN 1 ELSE 2 END, criado_em DESC LIMIT 80`,
        loja.id, iso(agora - 2 * DIA),
      );
      return json(lista.map((x) => this.pedidoView(x, 'loja')));
    }
    const pdm = p.match(/^\/v2\/loja\/pedidos\/([\w-]+)\/(aceitar|recusar)$/);
    if (metodo === 'POST' && pdm) {
      const ped = this.b.um(`SELECT * FROM pedidos WHERE id=? AND loja_id=?`, pdm[1], loja.id);
      if (!ped) return erro('Pedido não encontrado.', 404);
      if (ped.status !== 'aguardando_loja') return erro(ped.status === 'cancelado' ? 'Este pedido foi cancelado.' : 'Este pedido já foi respondido.', 409);
      if (pdm[2] === 'recusar') {
        const b = await corpo<{ motivo?: string }>();
        this.cancelarPedido(ped, 'loja_recusou', 'loja', Number(ped.total), `🚫 LOJA RECUSOU o pedido${b.motivo ? `: ${String(b.motivo).slice(0, 120)}` : ''}`);
        if (b.motivo) this.b.exec(`UPDATE pedidos SET motivo=? WHERE id=?`, `A loja recusou: ${String(b.motivo).trim().slice(0, 120)}`, ped.id);
        return json(this.pedidoView(this.pedido(ped.id)!, 'loja'));
      }
      this.chamarMotorista(ped, loja);
      return json(this.pedidoView(this.pedido(ped.id)!, 'loja'));
    }

    // Saldo e repasses
    if (metodo === 'GET' && p === '/v2/loja/saldo')
      return json({
        ...this.saldoLoja(loja.id), chavePix: chavePixLoja(loja).pix, pixTipo: chavePixLoja(loja).pixTipo, intervaloDias: cfg.saqueDias,
        vendas: this.b.q(`SELECT id, codigo, subtotal, liberado_em AS liberadoEm FROM pedidos WHERE loja_id=? AND liberado_em IS NOT NULL ORDER BY liberado_em DESC LIMIT 50`, loja.id),
        repasses: this.b.q(`SELECT id, valor, status, chave_pix AS chavePix, criado_em AS criadoEm, pago_em AS pagoEm, motivo FROM repasses_loja WHERE loja_id=? ORDER BY criado_em DESC LIMIT 30`, loja.id),
      });
    if (metodo === 'POST' && p === '/v2/loja/repasses') {
      const s = this.saldoLoja(loja.id);
      if (s.proximoRepasseEm) return erro(`Você poderá pedir o próximo repasse em ${new Date(s.proximoRepasseEm).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.`, 409);
      if (s.disponivel < 1) return erro('Sem vendas a receber.', 409);
      const { pix: chave, pixTipo } = chavePixLoja(loja);
      const id = novoId('rep');
      this.b.exec(`INSERT INTO repasses_loja (id, loja_id, valor, chave_pix, status, criado_em) VALUES (?,?,?,?, 'solicitado', ?)`, id, loja.id, s.disponivel, chave, iso(agora));
      this.b.avisar(`💸 REPASSE DE LOJA SOLICITADO\n${loja.loja_nome}: ${brl(s.disponivel)}\nPix (${nomeTipoChave(pixTipo)}): ${chave}\nVeja em Delivery para marcar como pago.`);
      return json({ ok: true, valor: s.disponivel });
    }
    return erro('Rota não encontrada.', 404);
  }

  /** Loja aceitou: a entrega vira uma corrida "delivery" já paga, procurando motorista agora. */
  private chamarMotorista(ped: Linha, loja: Linha) {
    const cfg = this.cfg;
    const agora = Date.now();
    const id = novoId('frete');
    const itens = JSON.parse(String(ped.itens)) as Item[];
    const qtd = itens.reduce((s, i) => s + i.qtd, 0);
    const cli = this.b.um(`SELECT nome FROM clientes WHERE id=?`, ped.cliente_id);
    this.b.exec(
      `INSERT INTO corridas (id, cliente_id, mercado_id, mercado_nome, agendado, inicio, fim, janela, status, valor, km, minutos, criado_em,
         servico, descricao, coleta_nome, coleta_endereco, coleta_lat, coleta_lon, entrega_nome, entrega_endereco, entrega_lat, entrega_lon,
         cliente_na_coleta, retorno, veiculo, km_desloc, pago_em, metodo, valor_cobrado, oferta_ate, pedido_id, urgencia)
       VALUES (?,?,?,?, 0, ?,?, 'Agora', 'buscando', ?,?,?,?, 'delivery', ?,?,?,?,?, 'Casa', ?,?,?, 0, 0, ?,?,?,?,?,?,?,?)`,
      id, ped.cliente_id, `loja:${loja.id}`, loja.loja_nome, iso(agora), iso(agora + cfg.bloqueioMin * MIN), ped.frete, ped.km ?? 0, ped.minutos ?? 0, iso(agora),
      `Pedido #${ped.codigo} · ${qtd} ${qtd === 1 ? 'item' : 'itens'} em nome de ${String(cli?.nome ?? 'cliente').split(' ')[0]} — retirar no balcão`,
      loja.loja_nome, loja.endereco, loja.lat, loja.lon, ped.entrega_endereco, ped.entrega_lat, ped.entrega_lon,
      ped.veiculo ?? 'carro', ped.km_desloc, ped.pago_em, ped.metodo, ped.frete, iso(agora + Math.max(cfg.ofertaMin, 15) * MIN), ped.id, Number(ped.urgencia ?? 0),
    );
    this.b.exec(`UPDATE pedidos SET status='aceito', aceito_em=?, corrida_id=? WHERE id=?`, iso(agora), id, ped.id);
    this.b.avisar(this.textoPedido(this.pedido(ped.id)!, `✅ LOJA ACEITOU — procurando ${ped.veiculo === 'moto' ? 'motoboy' : 'motorista'} para a entrega`), id);
  }

  // ---------- admin ----------
  async admin(req: Request, p: string, metodo: string): Promise<Response | null> {
    const agora = Date.now();
    if (metodo === 'GET' && p === '/v2/admin/delivery') {
      const lojas = this.b.q(`SELECT * FROM clientes WHERE tipo='lojista' AND status!='pendente' ORDER BY loja_nome`).map((l) => ({
        ...this.lojaPublica(l), status: l.status, ativaAte: l.delivery_ate ?? null, ativa: this.vitrineAtiva(l, agora), pix: l.pix_repasse ?? l.cnpj ?? l.cpf,
        telefone: l.telefone, responsavel: l.nome, saldo: this.saldoLoja(l.id),
        pedidos: Number(this.b.um(`SELECT COUNT(*) AS n FROM pedidos WHERE loja_id=? AND pago_em IS NOT NULL`, l.id)?.n ?? 0),
        produtosTotal: Number(this.b.um(`SELECT COUNT(*) AS n FROM produtos WHERE loja_id=?`, l.id)?.n ?? 0),
      }));
      return json({
        liberado: this.liberado(),
        lojas,
        repasses: this.b.q(`SELECT r.*, COALESCE(c.loja_nome, '(loja excluída)') AS loja_nome, c.telefone FROM repasses_loja r LEFT JOIN clientes c ON c.id=r.loja_id
          ORDER BY (r.status='solicitado') DESC, r.criado_em DESC LIMIT 100`),
        pedidos: this.b.q(`SELECT * FROM pedidos WHERE pago_em IS NOT NULL ORDER BY criado_em DESC LIMIT 150`).map((x) => this.pedidoView(x, 'admin')),
        mensalidades: this.b.q(`SELECT m.id, m.valor, m.dias, m.status, m.origem, m.metodo, m.pago_em AS pagoEm, m.criado_em AS criadoEm, COALESCE(c.loja_nome, '(loja excluída)') AS loja
          FROM mensalidades m LEFT JOIN clientes c ON c.id=m.loja_id WHERE m.status='paga' ORDER BY m.pago_em DESC LIMIT 100`),
      });
    }
    const dm = p.match(/^\/v2\/admin\/lojistas\/([\w-]+)\/delivery-dias$/);
    if (metodo === 'POST' && dm) {
      const b = ((await req.json().catch(() => ({}))) ?? {}) as { dias?: number };
      const dias = Math.round(Number(b.dias));
      if (!(dias >= 1 && dias <= 365)) return erro('Informe de 1 a 365 dias.');
      const l = this.b.um(`SELECT id FROM clientes WHERE id=? AND tipo='lojista'`, dm[1]);
      if (!l) return erro('Loja não encontrada.', 404);
      const ate = this.estender(l.id, dias);
      this.b.exec(`INSERT INTO mensalidades (id, loja_id, valor, dias, status, origem, criado_em, pago_em) VALUES (?,?,0,?, 'paga', 'cortesia', ?,?)`, novoId('mens'), l.id, dias, iso(agora), iso(agora));
      return json({ ativaAte: iso(ate) });
    }
    const rm = p.match(/^\/v2\/admin\/repasses-loja\/([\w-]+)\/(pagar|recusar)$/);
    if (metodo === 'POST' && rm) {
      const r = this.b.um(`SELECT * FROM repasses_loja WHERE id=?`, rm[1]);
      if (!r) return erro('Repasse não encontrado.', 404);
      if (r.status !== 'solicitado') return erro('Esse repasse já foi resolvido.', 409);
      const b = ((await req.json().catch(() => ({}))) ?? {}) as { motivo?: string };
      if (rm[2] === 'pagar') this.b.exec(`UPDATE repasses_loja SET status='pago', pago_em=? WHERE id=?`, iso(agora), r.id);
      else this.b.exec(`UPDATE repasses_loja SET status='recusado', motivo=? WHERE id=?`, String(b.motivo ?? '').slice(0, 200) || null, r.id);
      return json({ ok: true });
    }
    const cm = p.match(/^\/v2\/admin\/pedidos\/([\w-]+)\/cancelar$/);
    if (metodo === 'POST' && cm) {
      const ped = this.pedido(cm[1]);
      if (!ped) return erro('Pedido não encontrado.', 404);
      if (!['aguardando_loja', 'aceito'].includes(String(ped.status))) return erro('Pedido já encerrado.', 409);
      const c = ped.corrida_id ? this.b.corrida(ped.corrida_id) : undefined;
      if (c && !['entregue', 'cancelado'].includes(String(c.status))) {
        if (c.liberado_em) {
          this.b.exec(`DELETE FROM creditos WHERE corrida_id=?`, c.id);
          this.b.exec(`UPDATE corridas SET liberado_em=NULL WHERE id=?`, c.id);
        }
        this.b.cancelarCorrida({ ...this.b.corrida(c.id)!, status: 'admin' }, 'admin', 'admin', '❌ PEDIDO DO DELIVERY CANCELADO por você');
      } else this.cancelarPedido(ped, 'admin', 'admin', Number(ped.total), '❌ PEDIDO DO DELIVERY CANCELADO por você');
      return json({ ok: true });
    }
    return null;
  }

  /** Estornos de pedidos, no mesmo formato da lista de estornos das corridas. */
  estornos() {
    return this.b.q(`SELECT p.id, p.total AS valor, p.reembolso, p.reembolsado_em, p.motivo, p.cancelado_em, p.receipt_url, p.metodo,
        'Delivery · ' || COALESCE(l.loja_nome, 'loja') || ' · #' || p.codigo AS mercado_nome, 0 AS taxa_aplicada,
        COALESCE(c.nome, '(conta excluída)') AS cliente_nome, c.telefone AS cliente_telefone
      FROM pedidos p LEFT JOIN clientes c ON c.id=p.cliente_id LEFT JOIN clientes l ON l.id=p.loja_id WHERE p.reembolso > 0 ORDER BY (p.reembolsado_em IS NULL) DESC, p.cancelado_em DESC LIMIT 200`);
  }
  estornoFeito(id: string) {
    this.b.exec(`UPDATE pedidos SET reembolsado_em=? WHERE id=? AND reembolso > 0`, iso(Date.now()), id);
  }
  resumo() {
    const n = (sql: string, ...a: unknown[]) => Number(this.b.um(sql, ...a)?.n ?? 0);
    return {
      deliveryPedidosAbertos: n(`SELECT COUNT(*) AS n FROM pedidos WHERE status IN ('aguardando_loja','aceito')`),
      deliveryRetido: n(`SELECT COALESCE(SUM(subtotal),0) AS n FROM pedidos WHERE pago_em IS NOT NULL AND status IN ('aguardando_loja','aceito')`),
      repassesLojaPendentes: n(`SELECT COALESCE(SUM(valor),0) AS n FROM repasses_loja WHERE status='solicitado'`),
      repassesLojaPendentesQtd: n(`SELECT COUNT(*) AS n FROM repasses_loja WHERE status='solicitado'`),
      estornosPedidos: n(`SELECT COALESCE(SUM(reembolso),0) AS n FROM pedidos WHERE reembolso > 0 AND reembolsado_em IS NULL`),
      estornosPedidosQtd: n(`SELECT COUNT(*) AS n FROM pedidos WHERE reembolso > 0 AND reembolsado_em IS NULL`),
    };
  }
}
