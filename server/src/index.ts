// Servidor do Mercado Frete (Cloudflare Worker).
//
// - Recalcula o valor do frete (o app do cliente não decide quanto cobrar).
// - Agenda: cada frete ocupa `bloqueioMin` (40 min) para ir ao cliente e voltar ao mercado;
//   cancelou, o horário volta a ficar vago.
// - Pagamento pela InfinitePay: cria o link, recebe o cliente de volta (/retorno) e o webhook,
//   sempre confirmando em /payment_check (o webhook não tem assinatura).
// - Avisa o dono no WhatsApp (CallMeBot) a cada frete pago ou cancelado.
// - Agenda em formato iCalendar (/agenda.ics) com lembrete 15 min antes.
// - Rotas /admin/* para o App Admin (senha ADMIN_TOKEN).

import { MERCADOS } from '../../src/data/mercados';
import { TARIFAS_PADRAO } from '../../src/data/tarifas';
import {
  AGENDA_PADRAO,
  agoraDisponivel,
  dataLocal,
  horaLocal,
  horarioValido,
  proximosDias,
  rotuloDia,
  type Bloco,
  type ConfigAgenda,
} from '../../src/services/agenda';
import { rotasAteCasa } from '../../src/services/grafo';
import {
  estimarIdaEVolta,
  precoFrete,
  precoSugerido,
  URGENCIA_PADRAO,
  type Tarifa,
  type Urgencia,
} from '../../src/services/preco';
import { PAGINA_ADMIN } from './pagina-admin';

export interface Env {
  PEDIDOS: KVNamespace;
  INFINITEPAY_HANDLE: string;
  INFINITEPAY_API_KEY?: string; // segredo (opcional)
  ADMIN_TOKEN: string; // segredo: senha do App Admin
  APP_SCHEME: string;
  WHATSAPP_PHONE?: string; // segredo/variável: seu número com DDI, ex. +5547999999999
  CALLMEBOT_APIKEY?: string; // segredo: chave recebida do CallMeBot
}

export type Config = ConfigAgenda & { tarifas: Tarifa[]; margem: number; urgencia: Urgencia };
const CONFIG_PADRAO: Config = { ...AGENDA_PADRAO, tarifas: TARIFAS_PADRAO, margem: 0, urgencia: URGENCIA_PADRAO };

export type Status = 'reservado' | 'pago' | 'cancelado' | 'concluido';
export type Pedido = {
  orderNsu: string;
  status: Status;
  valor: number;
  mercadoId: string;
  mercadoNome: string;
  agendado: boolean;
  inicio: string; // ISO: início do atendimento
  fim: string; // ISO: inicio + bloqueio
  janela: string; // texto: "Hoje 21/11 · 10:20" ou "Agora"
  expiraEm?: string; // reserva sem pagamento segura o horário até aqui
  cliente: { nome: string; endereco: string; telefone?: string; lat: number; lon: number };
  checkoutUrl: string;
  cancelToken: string;
  criadoEm: string;
  pagoEm?: string;
  canceladoEm?: string;
  canceladoPor?: 'cliente' | 'admin';
  concluidoEm?: string;
  metodo?: string;
  receiptUrl?: string;
  transactionNsu?: string;
  slug?: string;
};

const API = 'https://api.checkout.infinitepay.io';
const MIN = 60_000;
const RESERVA_MIN = 15; // tempo para pagar segurando o horário
const CANCELA_URGENTE_MIN = 5; // urgente pode ser cancelado pelo cliente até 5 min após pagar

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, authorization', 'access-control-allow-methods': 'GET,POST,PUT' };
const json = (d: unknown, status = 200) =>
  new Response(JSON.stringify(d), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...CORS } });
const erro = (mensagem: string, status = 400) => json({ erro: mensagem }, status);
const brl = (v: number) => 'R$ ' + v.toFixed(2).replace('.', ',');

// ---------- armazenamento ----------

async function lerConfig(env: Env): Promise<Config> {
  const c = await env.PEDIDOS.get<Partial<Config>>('config', 'json');
  return { ...CONFIG_PADRAO, ...(c ?? {}) };
}

async function todosPedidos(env: Env): Promise<Pedido[]> {
  const out: Pedido[] = [];
  let cursor: string | undefined;
  do {
    const l = await env.PEDIDOS.list({ prefix: 'pedido:', cursor });
    const lote = await Promise.all(l.keys.map((k) => env.PEDIDOS.get<Pedido>(k.name, 'json')));
    for (const p of lote) if (p) out.push(p);
    cursor = l.list_complete ? undefined : l.cursor;
  } while (cursor);
  return out;
}

const salvar = (env: Env, p: Pedido) => env.PEDIDOS.put(`pedido:${p.orderNsu}`, JSON.stringify(p), { expirationTtl: 180 * 24 * 3600 });
const lerPedido = (env: Env, id: string) => env.PEDIDOS.get<Pedido>(`pedido:${id}`, 'json');

/** Horários ocupados: fretes pagos e reservas ainda dentro do prazo de pagamento. */
function ocupados(pedidos: Pedido[], agora: number): Bloco[] {
  return pedidos
    .filter((p) => p.status === 'pago' || (p.status === 'reservado' && p.expiraEm && Date.parse(p.expiraEm) > agora))
    .map((p) => ({ inicio: Date.parse(p.inicio), fim: Date.parse(p.fim) }))
    .filter((b) => b.fim > agora);
}

// ---------- preço ----------

export function calcularValor(cfg: Config, mercadoId: string, lat: number, lon: number, agendado: boolean): number | null {
  const m = MERCADOS.find((x) => x.id === mercadoId);
  if (!m) return null;
  const r = rotasAteCasa({ lat, lon }, [m])[m.id];
  if (!r) return null;
  const sugerido = precoSugerido(cfg.tarifas.map((t) => estimarIdaEVolta(r, t)), cfg.margem);
  return precoFrete(sugerido, agendado, cfg.urgencia);
}

// ---------- avisos ----------

const mapa = (p: Pedido) => `https://www.google.com/maps/search/?api=1&query=${p.cliente.lat},${p.cliente.lon}`;

function linkGoogleAgenda(p: Pedido) {
  const f = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const q = new URLSearchParams({
    action: 'TEMPLATE',
    text: `Frete ${p.mercadoNome} → ${p.cliente.nome || 'cliente'}`,
    dates: `${f(p.inicio)}/${f(p.fim)}`,
    details: `${p.agendado ? 'Agendado' : 'URGENTE'} · ${brl(p.valor)}\nTel: ${p.cliente.telefone ?? '-'}\nMapa: ${mapa(p)}`,
    location: p.cliente.endereco,
  });
  return `https://calendar.google.com/calendar/render?${q}`;
}

function textoPedido(p: Pedido, evento: 'pago' | 'cancelado') {
  const quando = p.agendado ? `${p.janela} (até ${horaLocal(Date.parse(p.fim))})` : `AGORA · ${horaLocal(Date.parse(p.inicio))}–${horaLocal(Date.parse(p.fim))}`;
  const cab =
    evento === 'cancelado'
      ? `❌ FRETE CANCELADO (${p.canceladoPor === 'admin' ? 'por você' : 'pelo cliente'}) — horário liberado`
      : p.agendado
        ? '📅 NOVO FRETE AGENDADO'
        : '🚨 FRETE URGENTE (agora)';
  const linhas = [
    cab,
    `Quando: ${quando}`,
    `Cliente: ${p.cliente.nome || '-'}${p.cliente.telefone ? ` · ${p.cliente.telefone}` : ''}`,
    `Mercado: ${p.mercadoNome}`,
    `Entregar em: ${p.cliente.endereco}`,
    `Mapa: ${mapa(p)}`,
    `Valor: ${brl(p.valor)}${p.metodo ? ` (${p.metodo === 'pix' ? 'Pix' : 'cartão'})` : ''}`,
  ];
  if (evento === 'pago') linhas.push(`Google Agenda: ${linkGoogleAgenda(p)}`);
  if (evento === 'cancelado' && p.pagoEm) linhas.push(`Estornar ${brl(p.valor)} pelo app da InfinitePay.`);
  return linhas.join('\n');
}

async function whatsapp(env: Env, texto: string): Promise<boolean> {
  if (!env.WHATSAPP_PHONE || !env.CALLMEBOT_APIKEY) return false;
  const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(env.WHATSAPP_PHONE)}&text=${encodeURIComponent(texto)}&apikey=${encodeURIComponent(env.CALLMEBOT_APIKEY)}`;
  const r = await fetch(url).catch(() => null);
  return !!r && r.ok;
}

// ---------- InfinitePay ----------

async function confirmar(env: Env, orderNsu: string, slug: string, transactionNsu: string) {
  const resp = await fetch(`${API}/payment_check`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ handle: env.INFINITEPAY_HANDLE, order_nsu: orderNsu, transaction_nsu: transactionNsu, slug }),
  });
  const d = (await resp.json().catch(() => ({}))) as { success?: boolean; paid?: boolean; capture_method?: string };
  return d.success === true && d.paid === true ? d : null;
}

async function marcarPago(env: Env, ctx: ExecutionContext, orderNsu: string, slug: string, tx: string, receiptUrl?: string) {
  const salvo = await lerPedido(env, orderNsu);
  if (!salvo) return null;
  if (salvo.status === 'pago' || salvo.status === 'concluido') return salvo;
  const ok = await confirmar(env, orderNsu, slug, tx);
  if (!ok) return salvo;
  const cfg = await lerConfig(env);
  const agora = Date.now();
  const p: Pedido = { ...salvo, status: 'pago', pagoEm: new Date(agora).toISOString(), metodo: ok.capture_method, receiptUrl: receiptUrl ?? salvo.receiptUrl, transactionNsu: tx, slug, expiraEm: undefined };
  if (!p.agendado) {
    // Urgente: os 40 min contam a partir do pagamento.
    p.inicio = new Date(agora).toISOString();
    p.fim = new Date(agora + cfg.bloqueioMin * MIN).toISOString();
  }
  await salvar(env, p);
  ctx.waitUntil(whatsapp(env, textoPedido(p, 'pago')));
  return p;
}

// ---------- rotas públicas (app do cliente) ----------

async function disponibilidade(env: Env) {
  const [cfg, pedidos] = await Promise.all([lerConfig(env), todosPedidos(env)]);
  const agora = Date.now();
  const occ = ocupados(pedidos, agora);
  return json({
    agora: agoraDisponivel(cfg, occ, agora),
    dias: proximosDias(cfg, occ, agora),
    bloqueioMin: cfg.bloqueioMin,
  });
}

async function criarPedido(req: Request, env: Env, origem: string) {
  const b = (await req.json().catch(() => null)) as { mercadoId?: string; agendado?: boolean; inicio?: string; cliente?: Pedido['cliente'] } | null;
  const c = b?.cliente;
  if (!b?.mercadoId || !c || typeof c.lat !== 'number' || typeof c.lon !== 'number') return erro('Pedido incompleto.');
  const mercado = MERCADOS.find((m) => m.id === b.mercadoId);
  if (!mercado) return erro('Mercado desconhecido.');
  const [cfg, pedidos] = await Promise.all([lerConfig(env), todosPedidos(env)]);
  const agora = Date.now();
  const occ = ocupados(pedidos, agora);

  let inicio: number;
  if (b.agendado) {
    inicio = Date.parse(b.inicio ?? '');
    if (!Number.isFinite(inicio) || !horarioValido(inicio, cfg, occ, agora))
      return erro('Esse horário não está mais disponível. Escolha outro.', 409);
  } else {
    const d = agoraDisponivel(cfg, occ, agora);
    if (!d.ok) return erro(d.motivo ?? 'Indisponível agora.', 409);
    inicio = agora;
  }
  const valor = calcularValor(cfg, mercado.id, c.lat, c.lon, !!b.agendado);
  if (valor === null) return erro('Não há rota até esse endereço.');

  const orderNsu = `frete-${agora.toString(36)}-${crypto.randomUUID().slice(0, 6)}`;
  const janela = b.agendado ? `${rotuloDia(dataLocal(inicio), dataLocal(agora))} · ${horaLocal(inicio)}` : 'Agora';
  const comChave = !!env.INFINITEPAY_API_KEY;
  const resp = await fetch(`${API}/links`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(comChave ? { 'X-Api-Key': env.INFINITEPAY_API_KEY! } : {}) },
    body: JSON.stringify({
      handle: env.INFINITEPAY_HANDLE,
      items: [{ quantity: 1, price: Math.max(100, Math.round(valor * 100)), description: `Frete ${mercado.nome} - ${b.agendado ? janela : 'entrega agora'}`.slice(0, 120) }],
      order_nsu: orderNsu,
      redirect_url: `${origem}/retorno`,
      webhook_url: `${origem}/webhook`,
      customer: c.nome ? { name: c.nome, phone_number: c.telefone } : undefined,
      // Com a chave, o link vale para um pagamento e expira junto com a reserva do horário.
      options: comChave ? { single_payment: true, valid_until: new Date(agora + RESERVA_MIN * MIN).toISOString() } : undefined,
    }),
  });
  const d = (await resp.json().catch(() => ({}))) as { url?: string; message?: string };
  if (!resp.ok || !d.url) return erro(d.message ?? 'Não foi possível gerar o pagamento.', 502);

  const pedido: Pedido = {
    orderNsu,
    status: 'reservado',
    valor,
    mercadoId: mercado.id,
    mercadoNome: mercado.nome,
    agendado: !!b.agendado,
    inicio: new Date(inicio).toISOString(),
    fim: new Date(inicio + cfg.bloqueioMin * MIN).toISOString(),
    janela,
    expiraEm: new Date(agora + RESERVA_MIN * MIN).toISOString(),
    cliente: { nome: String(c.nome ?? ''), endereco: String(c.endereco ?? ''), telefone: c.telefone ? String(c.telefone) : undefined, lat: c.lat, lon: c.lon },
    checkoutUrl: d.url,
    cancelToken: crypto.randomUUID(),
    criadoEm: new Date(agora).toISOString(),
  };
  await salvar(env, pedido);
  return json({ orderNsu, valor, url: d.url, janela, inicio: pedido.inicio, cancelToken: pedido.cancelToken });
}

function podeClienteCancelar(p: Pedido, agora: number) {
  if (p.status === 'reservado') return true;
  if (p.status !== 'pago') return false;
  if (p.agendado) return Date.parse(p.inicio) > agora;
  return !!p.pagoEm && agora - Date.parse(p.pagoEm) <= CANCELA_URGENTE_MIN * MIN;
}

async function cancelar(env: Env, ctx: ExecutionContext, p: Pedido, por: 'cliente' | 'admin') {
  const novo: Pedido = { ...p, status: 'cancelado', canceladoEm: new Date().toISOString(), canceladoPor: por };
  await salvar(env, novo);
  if (p.status === 'pago') ctx.waitUntil(whatsapp(env, textoPedido(novo, 'cancelado')));
  return novo;
}

const publico = (p: Pedido, agora = Date.now()) => ({
  orderNsu: p.orderNsu,
  status: p.status,
  valor: p.valor,
  janela: p.janela,
  inicio: p.inicio,
  agendado: p.agendado,
  receiptUrl: p.receiptUrl,
  metodo: p.metodo,
  podeCancelar: podeClienteCancelar(p, agora),
});

// ---------- agenda (.ics) ----------

async function chaveAgenda(env: Env) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`agenda:${env.ADMIN_TOKEN}`));
  return [...new Uint8Array(h)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function ics(pedidos: Pedido[]) {
  const f = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (m) => '\\' + m);
  const ev = pedidos
    .filter((p) => p.status === 'pago' || p.status === 'concluido')
    .map((p) =>
      [
        'BEGIN:VEVENT',
        `UID:${p.orderNsu}@mercadofrete`,
        `DTSTAMP:${f(p.pagoEm ?? p.criadoEm)}`,
        `DTSTART:${f(p.inicio)}`,
        `DTEND:${f(p.fim)}`,
        `SUMMARY:${esc(`${p.agendado ? '' : '🚨 '}Frete ${p.mercadoNome} → ${p.cliente.nome || 'cliente'}`)}`,
        `LOCATION:${esc(p.cliente.endereco)}`,
        `DESCRIPTION:${esc(`${brl(p.valor)} · Tel: ${p.cliente.telefone ?? '-'} · Mapa: ${mapa(p)}`)}`,
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        'DESCRIPTION:Frete em 15 minutos',
        'TRIGGER:-PT15M',
        'END:VALARM',
        'END:VEVENT',
      ].join('\r\n'),
    );
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Mercado Frete//PT-BR', 'X-WR-CALNAME:Mercado Frete', 'X-PUBLISHED-TTL:PT5M', ...ev, 'END:VCALENDAR'].join('\r\n');
}

// ---------- página de retorno do pagamento ----------

function paginaRetorno(env: Env, p: Pedido | null, orderNsu: string) {
  const pago = p?.status === 'pago';
  const link = `${env.APP_SCHEME}://pagamento?order_nsu=${encodeURIComponent(orderNsu)}&status=${pago ? 'pago' : 'aguardando'}`;
  const titulo = pago ? 'Frete confirmado!' : 'Pagamento em processamento';
  return new Response(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${titulo}</title><style>body{font-family:system-ui,sans-serif;background:#F2F5F3;color:#15201A;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;text-align:center}
a{display:inline-block;margin-top:16px;background:#1B8048;color:#fff;padding:14px 24px;border-radius:12px;text-decoration:none;font-weight:700}</style></head>
<body><div><h1>${titulo}</h1><p>${pago ? `${p!.janela === 'Agora' ? 'Entrega o quanto antes.' : `Entrega ${p!.janela}.`} Pode voltar ao app.` : 'Assim que a InfinitePay confirmar, o frete aparece como confirmado no app.'}</p>
<a href="${link}">Voltar ao Mercado Frete</a></div><script>location.href=${JSON.stringify(link)}</script></body></html>`,
    { headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}

// ---------- rotas do App Admin ----------

async function rotasAdmin(req: Request, env: Env, ctx: ExecutionContext, url: URL): Promise<Response> {
  if (!env.ADMIN_TOKEN || req.headers.get('authorization') !== `Bearer ${env.ADMIN_TOKEN}`) return erro('Não autorizado.', 401);
  const caminho = url.pathname.slice('/admin'.length);
  const agora = Date.now();

  if (req.method === 'GET' && caminho === '/pedidos') {
    const pedidos = await todosPedidos(env);
    return json(pedidos.sort((a, b) => (a.inicio < b.inicio ? 1 : -1)));
  }
  if (req.method === 'GET' && caminho === '/status') {
    const [cfg, pedidos] = await Promise.all([lerConfig(env), todosPedidos(env)]);
    const occ = ocupados(pedidos, agora);
    const atual = occ.find((o) => o.inicio <= agora && agora < o.fim);
    return json({ config: cfg, ocupadoAte: atual ? new Date(atual.fim).toISOString() : null, agora: agoraDisponivel(cfg, occ, agora) });
  }
  if (req.method === 'PUT' && caminho === '/config') {
    const novo = (await req.json().catch(() => null)) as Partial<Config> | null;
    if (!novo) return erro('Configuração inválida.');
    const cfg = { ...(await lerConfig(env)), ...novo };
    if (!(cfg.bloqueioMin >= 10 && cfg.bloqueioMin <= 240 && cfg.passoMin >= 5)) return erro('Intervalos inválidos.');
    await env.PEDIDOS.put('config', JSON.stringify(cfg));
    return json(cfg);
  }
  if (req.method === 'POST' && caminho === '/livre') {
    // "Estou livre": encerra o atendimento em andamento e reabre os pedidos.
    const pedidos = await todosPedidos(env);
    const emAndamento = pedidos.filter((p) => p.status === 'pago' && Date.parse(p.inicio) <= agora && agora < Date.parse(p.fim));
    await Promise.all(emAndamento.map((p) => salvar(env, { ...p, status: 'concluido', concluidoEm: new Date(agora).toISOString(), fim: new Date(agora).toISOString() })));
    const cfg = { ...(await lerConfig(env)), aberto: true };
    await env.PEDIDOS.put('config', JSON.stringify(cfg));
    return json({ ok: true, concluidos: emAndamento.length });
  }
  const m = caminho.match(/^\/pedidos\/([\w-]+)\/(concluir|cancelar)$/);
  if (req.method === 'POST' && m) {
    const p = await lerPedido(env, m[1]);
    if (!p) return erro('Pedido não encontrado.', 404);
    if (m[2] === 'cancelar') return json(await cancelar(env, ctx, p, 'admin'));
    const fim = Math.min(Date.parse(p.fim), agora);
    const novo: Pedido = { ...p, status: 'concluido', concluidoEm: new Date(agora).toISOString(), fim: new Date(Math.max(fim, Date.parse(p.inicio))).toISOString() };
    await salvar(env, novo);
    return json(novo);
  }
  if (req.method === 'GET' && caminho === '/agenda-link') return json({ url: `${url.origin}/agenda.ics?k=${await chaveAgenda(env)}` });
  if (req.method === 'POST' && caminho === '/whatsapp-teste') {
    const ok = await whatsapp(env, '✅ Mercado Frete: avisos de pedidos ativados neste WhatsApp.');
    return ok ? json({ ok }) : erro(env.CALLMEBOT_APIKEY ? 'O CallMeBot não aceitou o envio. Confira número e chave.' : 'WhatsApp ainda não configurado no servidor.', 400);
  }
  return erro('Rota não encontrada.', 404);
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const origem = url.origin;
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

    if (url.pathname === '/admin' || url.pathname === '/admin/')
      return new Response(PAGINA_ADMIN, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    if (url.pathname.startsWith('/admin/')) return rotasAdmin(req, env, ctx, url);

    if (req.method === 'GET' && url.pathname === '/config') {
      const c = await lerConfig(env);
      return json({ tarifas: c.tarifas, margem: c.margem, urgencia: c.urgencia, bloqueioMin: c.bloqueioMin });
    }
    if (req.method === 'GET' && url.pathname === '/disponibilidade') return disponibilidade(env);
    if (req.method === 'POST' && url.pathname === '/pedidos') return criarPedido(req, env, origem);

    const pm = url.pathname.match(/^\/pedidos\/([\w-]+)(\/cancelar)?$/);
    if (pm) {
      const p = await lerPedido(env, pm[1]);
      if (!p) return erro('Pedido não encontrado.', 404);
      if (req.method === 'GET' && !pm[2]) return json(publico(p));
      if (req.method === 'POST' && pm[2]) {
        const b = (await req.json().catch(() => ({}))) as { token?: string };
        if (b.token !== p.cancelToken) return erro('Não autorizado.', 403);
        if (!podeClienteCancelar(p, Date.now())) return erro('Este frete não pode mais ser cancelado pelo app.', 409);
        return json(publico(await cancelar(env, ctx, p, 'cliente')));
      }
    }

    if (req.method === 'GET' && url.pathname === '/retorno') {
      const q = url.searchParams;
      const orderNsu = q.get('order_nsu') ?? '';
      const slug = q.get('slug'), tx = q.get('transaction_nsu');
      const p = slug && tx ? await marcarPago(env, ctx, orderNsu, slug, tx, q.get('receipt_url') ?? undefined) : null;
      return paginaRetorno(env, p, orderNsu);
    }
    if (req.method === 'POST' && url.pathname === '/webhook') {
      const b = (await req.json().catch(() => null)) as { order_nsu?: string; invoice_slug?: string; transaction_nsu?: string; receipt_url?: string } | null;
      if (!b?.order_nsu || !b.invoice_slug || !b.transaction_nsu) return new Response('dados incompletos', { status: 400 });
      await marcarPago(env, ctx, b.order_nsu, b.invoice_slug, b.transaction_nsu, b.receipt_url);
      return new Response('ok');
    }
    if (req.method === 'GET' && url.pathname === '/agenda.ics') {
      if (!env.ADMIN_TOKEN || url.searchParams.get('k') !== (await chaveAgenda(env))) return new Response('não autorizado', { status: 403 });
      return new Response(ics(await todosPedidos(env)), { headers: { 'content-type': 'text/calendar; charset=utf-8' } });
    }
    return erro('Rota não encontrada.', 404);
  },
};
