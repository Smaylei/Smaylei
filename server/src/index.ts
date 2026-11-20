// Servidor de pagamentos do Mercado Frete (Cloudflare Worker).
//
// Por que existe: a API Key da InfinitePay não pode ficar no app, a InfinitePay só devolve o
// cliente para endereços https e o webhook dela não tem assinatura. Este servidor:
//   1. recalcula o valor do frete (o app não decide quanto cobrar);
//   2. cria o link com a API Key (pagamento único, expira em 24 h);
//   3. recebe o cliente de volta (/retorno), confirma em /payment_check e reabre o app;
//   4. recebe o webhook (/webhook) e confirma do mesmo jeito;
//   5. guarda os pedidos (KV) e lista os pagos para a operação (/admin/pedidos).

import { MERCADOS } from '../../src/data/mercados';
import { TARIFAS_PADRAO } from '../../src/data/tarifas';
import { rotasAteCasa } from '../../src/services/grafo';
import { estimarIdaEVolta, precoFrete, precoSugerido, URGENCIA_PADRAO } from '../../src/services/preco';

export interface Env {
  PEDIDOS: KVNamespace;
  INFINITEPAY_HANDLE: string;
  INFINITEPAY_API_KEY: string; // secret: npx wrangler secret put INFINITEPAY_API_KEY
  ADMIN_TOKEN: string; // secret: senha para listar pedidos
  APP_SCHEME: string; // ex.: mercadofrete
}

type Pedido = {
  orderNsu: string;
  status: 'aguardando' | 'pago';
  valor: number;
  mercadoId: string;
  mercadoNome: string;
  agendado: boolean;
  janela?: string;
  cliente: { nome: string; endereco: string; lat: number; lon: number; telefone?: string };
  checkoutUrl: string;
  criadoEm: string;
  pagoEm?: string;
  metodo?: string;
  receiptUrl?: string;
  transactionNsu?: string;
  slug?: string;
};

const API = 'https://api.checkout.infinitepay.io';
const json = (d: unknown, status = 200) =>
  new Response(JSON.stringify(d), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' },
  });
const erro = (mensagem: string, status = 400) => json({ erro: mensagem }, status);

/** Valor do frete calculado no servidor, com a mesma regra do app. */
export function calcularValor(mercadoId: string, lat: number, lon: number, agendado: boolean): number | null {
  const m = MERCADOS.find((x) => x.id === mercadoId);
  if (!m) return null;
  const r = rotasAteCasa({ lat, lon }, [m])[m.id];
  if (!r) return null;
  const sugerido = precoSugerido(TARIFAS_PADRAO.map((t) => estimarIdaEVolta(r, t)), 0);
  return precoFrete(sugerido, agendado, URGENCIA_PADRAO);
}

async function confirmar(env: Env, orderNsu: string, slug: string, transactionNsu: string) {
  const resp = await fetch(`${API}/payment_check`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ handle: env.INFINITEPAY_HANDLE, order_nsu: orderNsu, transaction_nsu: transactionNsu, slug }),
  });
  const d = (await resp.json().catch(() => ({}))) as { success?: boolean; paid?: boolean; paid_amount?: number; capture_method?: string };
  return d.success === true && d.paid === true ? d : null;
}

async function marcarPago(env: Env, orderNsu: string, slug: string, transactionNsu: string, receiptUrl?: string) {
  const salvo = await env.PEDIDOS.get<Pedido>(`pedido:${orderNsu}`, 'json');
  if (!salvo) return null;
  if (salvo.status === 'pago') return salvo;
  const ok = await confirmar(env, orderNsu, slug, transactionNsu);
  if (!ok) return salvo;
  const pago: Pedido = {
    ...salvo,
    status: 'pago',
    pagoEm: new Date().toISOString(),
    metodo: ok.capture_method,
    receiptUrl: receiptUrl ?? salvo.receiptUrl,
    transactionNsu,
    slug,
  };
  await env.PEDIDOS.put(`pedido:${orderNsu}`, JSON.stringify(pago));
  return pago;
}

async function criarPedido(req: Request, env: Env, origem: string) {
  const b = (await req.json().catch(() => null)) as {
    mercadoId?: string;
    agendado?: boolean;
    janela?: string;
    cliente?: Pedido['cliente'];
  } | null;
  const c = b?.cliente;
  if (!b?.mercadoId || !c || typeof c.lat !== 'number' || typeof c.lon !== 'number') return erro('Pedido incompleto.');
  const mercado = MERCADOS.find((m) => m.id === b.mercadoId);
  if (!mercado) return erro('Mercado desconhecido.');
  if (b.agendado && !b.janela) return erro('Escolha o dia e o horário.');
  const valor = calcularValor(mercado.id, c.lat, c.lon, !!b.agendado);
  if (valor === null) return erro('Não há rota até esse endereço.');

  const orderNsu = `frete-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 6)}`;
  const validoAte = new Date(Date.now() + 24 * 3600e3).toISOString();
  const resp = await fetch(`${API}/links`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Api-Key': env.INFINITEPAY_API_KEY },
    body: JSON.stringify({
      handle: env.INFINITEPAY_HANDLE,
      items: [
        {
          quantity: 1,
          price: Math.max(100, Math.round(valor * 100)),
          description: `Frete ${mercado.nome} - ${b.agendado ? `agendado ${b.janela}` : 'entrega agora'}`.slice(0, 120),
        },
      ],
      order_nsu: orderNsu,
      redirect_url: `${origem}/retorno`,
      webhook_url: `${origem}/webhook`,
      customer: c.nome ? { name: c.nome, phone_number: c.telefone } : undefined,
      options: { single_payment: true, valid_until: validoAte },
    }),
  });
  const d = (await resp.json().catch(() => ({}))) as { url?: string; error?: string; message?: string };
  if (!resp.ok || !d.url) return erro(d.message ?? 'Não foi possível gerar o pagamento.', 502);

  const pedido: Pedido = {
    orderNsu,
    status: 'aguardando',
    valor,
    mercadoId: mercado.id,
    mercadoNome: mercado.nome,
    agendado: !!b.agendado,
    janela: b.janela,
    cliente: { nome: String(c.nome ?? ''), endereco: String(c.endereco ?? ''), lat: c.lat, lon: c.lon, telefone: c.telefone },
    checkoutUrl: d.url,
    criadoEm: new Date().toISOString(),
  };
  await env.PEDIDOS.put(`pedido:${orderNsu}`, JSON.stringify(pedido), { expirationTtl: 90 * 24 * 3600 });
  return json({ orderNsu, valor, url: d.url });
}

function paginaRetorno(env: Env, p: Pedido | null, orderNsu: string) {
  const pago = p?.status === 'pago';
  const link = `${env.APP_SCHEME}://pagamento?order_nsu=${encodeURIComponent(orderNsu)}&status=${pago ? 'pago' : 'aguardando'}`;
  const titulo = pago ? 'Frete pago!' : 'Pagamento em processamento';
  return new Response(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${titulo}</title><style>body{font-family:system-ui,sans-serif;background:#F2F5F3;color:#15201A;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;text-align:center}
a{display:inline-block;margin-top:16px;background:#1B8048;color:#fff;padding:14px 24px;border-radius:12px;text-decoration:none;font-weight:700}</style></head>
<body><div><h1>${titulo}</h1><p>${pago ? 'Pode voltar ao app.' : 'Assim que a InfinitePay confirmar, o pedido aparece como pago.'}</p>
<a href="${link}">Voltar ao Mercado Frete</a></div><script>location.href=${JSON.stringify(link)}</script></body></html>`,
    { headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}

// Página dos pedidos para a operação: pede a senha (ADMIN_TOKEN) e lista os fretes.
const PAGINA_ADMIN = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pedidos de frete</title><style>
body{font-family:system-ui,sans-serif;background:#F2F5F3;color:#15201A;margin:0;padding:16px;max-width:760px;margin-inline:auto}
h1{font-size:22px}input,button{font:inherit;padding:10px 12px;border-radius:10px;border:1px solid #DAE2DD}button{background:#1B8048;color:#fff;border:0;font-weight:700}
.p{background:#fff;border:1px solid #DAE2DD;border-radius:12px;padding:12px 14px;margin:8px 0}.pago{border-left:6px solid #1B8048}.aguardando{border-left:6px solid #C9A227;opacity:.75}
.t{display:flex;justify-content:space-between;gap:8px;font-weight:700}.m{color:#5B6A62;font-size:14px;margin-top:4px}a{color:#1B8048}
</style></head><body><h1>Pedidos de frete</h1>
<form id="f"><input id="s" type="password" placeholder="Senha" autocomplete="current-password"> <button>Entrar</button>
<label style="margin-left:8px"><input type="checkbox" id="todos"> mostrar não pagos</label></form><div id="l"></div>
<script>
const brl=v=>'R$ '+v.toFixed(2).replace('.',',');
const el=(t,c,x)=>{const e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e;};
async function carregar(){const s=document.getElementById('s').value||localStorage.getItem('senha')||'';if(!s)return;
 const r=await fetch('/admin/pedidos',{headers:{authorization:'Bearer '+s}});const l=document.getElementById('l');l.textContent='';
 if(!r.ok){l.append(el('p','', 'Senha incorreta.'));return;}localStorage.setItem('senha',s);
 const todos=document.getElementById('todos').checked;
 for(const p of await r.json()){ if(!todos&&p.status!=='pago')continue;
  const d=el('div','p '+p.status);const t=el('div','t');t.append(el('span','',p.mercadoNome+' → '+(p.cliente.nome||'Cliente')),el('span','',brl(p.valor)));d.append(t);
  d.append(el('div','m',(p.status==='pago'?'✓ Pago ('+(p.metodo==='pix'?'Pix':'cartão')+')':'Aguardando pagamento')+' · '+(p.agendado?'Agendado: '+p.janela:'Entrega agora')+' · '+new Date(p.criadoEm).toLocaleString('pt-BR')));
  const m=el('div','m');m.append(el('span','',p.cliente.endereco+' '));const a=el('a','', 'abrir no mapa');a.href='https://www.google.com/maps/search/?api=1&query='+p.cliente.lat+','+p.cliente.lon;a.target='_blank';m.append(a);d.append(m);
  if(p.receiptUrl){const c=el('a','', 'comprovante');c.href=p.receiptUrl;c.target='_blank';const mm=el('div','m');mm.append(c);d.append(mm);}
  l.append(d);} }
document.getElementById('f').onsubmit=e=>{e.preventDefault();carregar();};document.getElementById('todos').onchange=carregar;carregar();setInterval(carregar,30000);
</script></body></html>`;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const origem = url.origin;
    if (req.method === 'OPTIONS')
      return new Response(null, {
        headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST' },
      });

    if (req.method === 'POST' && url.pathname === '/pedidos') return criarPedido(req, env, origem);

    if (req.method === 'GET' && url.pathname.startsWith('/pedidos/')) {
      const p = await env.PEDIDOS.get<Pedido>(`pedido:${url.pathname.slice('/pedidos/'.length)}`, 'json');
      return p ? json({ orderNsu: p.orderNsu, status: p.status, valor: p.valor, receiptUrl: p.receiptUrl, metodo: p.metodo }) : erro('Pedido não encontrado.', 404);
    }

    if (req.method === 'GET' && url.pathname === '/retorno') {
      const q = url.searchParams;
      const orderNsu = q.get('order_nsu') ?? '';
      const slug = q.get('slug'), tx = q.get('transaction_nsu');
      const p = slug && tx ? await marcarPago(env, orderNsu, slug, tx, q.get('receipt_url') ?? undefined) : null;
      return paginaRetorno(env, p, orderNsu);
    }

    if (req.method === 'POST' && url.pathname === '/webhook') {
      // O webhook não tem assinatura: cada aviso é confirmado em /payment_check antes de valer.
      const b = (await req.json().catch(() => null)) as { order_nsu?: string; invoice_slug?: string; transaction_nsu?: string; receipt_url?: string } | null;
      if (!b?.order_nsu || !b.invoice_slug || !b.transaction_nsu) return new Response('dados incompletos', { status: 400 });
      await marcarPago(env, b.order_nsu, b.invoice_slug, b.transaction_nsu, b.receipt_url);
      return new Response('ok');
    }

    if (req.method === 'GET' && (url.pathname === '/admin' || url.pathname === '/admin/')) {
      return new Response(PAGINA_ADMIN, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }

    if (req.method === 'GET' && url.pathname === '/admin/pedidos') {
      if (!env.ADMIN_TOKEN || req.headers.get('authorization') !== `Bearer ${env.ADMIN_TOKEN}`) return erro('Não autorizado.', 401);
      const lista = await env.PEDIDOS.list({ prefix: 'pedido:' });
      const pedidos = await Promise.all(lista.keys.map((k) => env.PEDIDOS.get<Pedido>(k.name, 'json')));
      return json(pedidos.filter(Boolean).sort((a, b) => (a!.criadoEm < b!.criadoEm ? 1 : -1)));
    }

    return erro('Rota não encontrada.', 404);
  },
};
