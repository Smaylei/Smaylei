// Teste de ponta a ponta da Central (Durable Object) com SQLite local, InfinitePay e WhatsApp simulados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import worker, { Central } from '../.teste/worker.mjs';

// ---- ambiente simulado ----
const db = new DatabaseSync(':memory:');
const sql = {
  exec(q, ...a) {
    const st = db.prepare(q);
    const linhas = /^\s*(SELECT|WITH)/i.test(q) ? st.all(...a) : (st.run(...a), []);
    return { toArray: () => linhas };
  },
};
const pend = [];
const ctx = { storage: { sql }, blockConcurrencyWhile: (fn) => fn(), waitUntil: (p) => pend.push(p) };
const arquivos = new Map();
const env = {
  INFINITEPAY_HANDLE: 'loja',
  ADMIN_TOKEN: 'senha-admin',
  APP_SCHEME: 'mercadofrete',
  WHATSAPP_PHONE: '+5547999149325',
  CALLMEBOT_APIKEY: 'k',
  DOCS: {
    put: async (k, v, o) => void arquivos.set(k, { v, ct: o?.httpMetadata?.contentType }),
    get: async (k) => (arquivos.has(k) ? { body: arquivos.get(k).v, httpMetadata: { contentType: arquivos.get(k).ct } } : null),
  },
};
const central = new Central(ctx, env);
env.CENTRAL = { idFromName: () => 'x', get: () => ({ fetch: (r) => central.fetch(r) }) };
const zaps = [];
let linkCriado;
globalThis.fetch = async (url, init) => {
  url = String(url);
  if (url.endsWith('/links')) {
    linkCriado = JSON.parse(init.body);
    return new Response(JSON.stringify({ url: 'https://checkout.infinitepay.io/loja?lenc=x' }));
  }
  if (url.endsWith('/payment_check')) return new Response(JSON.stringify({ success: true, paid: true, capture_method: 'pix' }));
  if (url.startsWith('https://api.callmebot.com/')) {
    zaps.push(new URL(url).searchParams.get('text'));
    return new Response('ok');
  }
  throw new Error('fetch inesperado ' + url);
};
const B = 'https://srv.test';
async function call(path, { metodo = 'GET', token, corpo, bruto, tipo } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (tipo) headers['content-type'] = tipo;
  const r = await worker.fetch(new Request(B + path, { method: metodo, headers, body: bruto ?? (corpo ? JSON.stringify(corpo) : undefined) }), env);
  await Promise.all(pend.splice(0));
  const t = await r.text();
  try {
    return { s: r.status, d: JSON.parse(t) };
  } catch {
    return { s: r.status, d: t };
  }
}
const ADM = 'senha-admin';
const JPG = new Uint8Array(5000).fill(1);

// Relógio fixo: segunda 23/11/2026, 10:00 em Brasília.
let relogio = Date.parse('2026-11-23T13:00:00Z');
Date.now = () => relogio;
const avanca = (min) => (relogio += min * 60_000);

let cliente, motorista, corridaId;

test('cadastro de cliente e motorista com validação de CPF e placa', async () => {
  assert.equal((await call('/v2/clientes', { metodo: 'POST', corpo: { nome: 'Ana Souza', cpf: '111.111.111-11', endereco: 'Rua X, 10', lat: -26.4893, lon: -48.9872 } })).s, 400);
  const c = await call('/v2/clientes', {
    metodo: 'POST',
    corpo: { nome: 'Ana Souza', cpf: '529.982.247-25', telefone: '(47) 98888-7777', endereco: 'Rua X, 10, Corticeira', lat: -26.4893, lon: -48.9872 },
  });
  assert.equal(c.s, 200, JSON.stringify(c.d));
  cliente = c.d.token;
  assert.equal((await call('/v2/arquivos?tipo=foto', { metodo: 'POST', token: cliente, bruto: JPG, tipo: 'image/jpeg' })).s, 200);

  assert.equal((await call('/v2/motoristas', { metodo: 'POST', corpo: { nome: 'Smaylei Luiz', cpf: '529.982.247-25', telefone: '47999149325', carro: 'Fiat Strada', placa: 'XYZ' } })).s, 400);
  const m = await call('/v2/motoristas', {
    metodo: 'POST',
    corpo: { nome: 'Smaylei Luiz', cpf: '153.509.460-56', telefone: '47999149325', carro: 'Fiat Strada', placa: 'abc-1d23', cor: 'Branca', pix: '47999149325' },
  });
  assert.equal(m.s, 200, JSON.stringify(m.d));
  motorista = m.d.token;
  assert.match(zaps.at(-1), /NOVO MOTORISTA/);
});

test('motorista só fica online depois de enviar documentos e ser aprovado', async () => {
  assert.equal((await call('/v2/eu/online', { metodo: 'POST', token: motorista, corpo: { online: true } })).s, 403);
  assert.equal((await call('/v2/disponibilidade')).d.dias.length, 0); // nenhum motorista aprovado
  await call('/v2/arquivos?tipo=selfie', { metodo: 'POST', token: motorista, bruto: JPG, tipo: 'image/jpeg' });
  await call('/v2/arquivos?tipo=cnh', { metodo: 'POST', token: motorista, bruto: JPG, tipo: 'image/jpeg' });
  const lista = await call('/v2/admin/motoristas', { token: ADM });
  assert.equal(lista.d[0].status, 'pendente');
  assert.ok(lista.d[0].selfie && lista.d[0].cnh);
  assert.equal((await call(`/v2/admin/arquivo?chave=${encodeURIComponent(lista.d[0].cnh)}`, { token: ADM })).s, 200);
  assert.equal((await call(`/v2/admin/motoristas/${lista.d[0].id}/status`, { metodo: 'POST', token: ADM, corpo: { status: 'aprovado' } })).s, 200);
  const on = await call('/v2/eu/online', { metodo: 'POST', token: motorista, corpo: { online: true, lat: -26.475, lon: -49.0 } });
  assert.equal(on.s, 200, JSON.stringify(on.d));
  assert.equal((await call('/v2/disponibilidade')).d.agora.ok, true);
});

test('pedido agora → oferta → aceite → chat → chegou ao mercado → pagamento → entregue', async () => {
  const c = await call('/v2/corridas', { metodo: 'POST', token: cliente, corpo: { mercadoId: 'cooper', agendado: false } });
  assert.equal(c.s, 200, JSON.stringify(c.d));
  assert.equal(c.d.status, 'buscando');
  corridaId = c.d.id;
  assert.match(zaps.at(-1), /NOVO FRETE URGENTE/);

  const ofertas = await call('/v2/ofertas', { token: motorista });
  assert.equal(ofertas.d.length, 1);
  assert.equal(ofertas.d[0].ganho, Math.round(c.d.valor * 0.8 * 100) / 100); // 80% do frete
  assert.equal(ofertas.d[0].cliente.telefone, null); // telefone só depois de aceitar
  assert.ok(ofertas.d[0].km > 0 && ofertas.d[0].kmAteMercado >= 0);

  const ac = await call(`/v2/ofertas/${corridaId}/aceitar`, { metodo: 'POST', token: motorista });
  assert.equal(ac.d.status, 'aceito');
  assert.equal(ac.d.cliente.telefone, '47988887777');
  assert.match(zaps.at(-1), /CORRIDA ACEITA/);

  // cliente acompanha: vê o motorista, a placa e a posição
  const atv = await call('/v2/corridas/ativas', { token: cliente });
  assert.equal(atv.d[0].motorista.placa, 'ABC1D23');
  assert.equal(atv.d[0].motorista.lat, -26.475);
  assert.equal((await call(`/v2/corridas/${corridaId}/foto-motorista`, { token: cliente })).s, 200);
  await call('/v2/eu/local', { metodo: 'POST', token: motorista, corpo: { lat: -26.472, lon: -48.98 } });
  assert.equal((await call(`/v2/corridas/${corridaId}`, { token: cliente })).d.motorista.lon, -48.98);

  // chat
  await call(`/v2/corridas/${corridaId}/mensagens`, { metodo: 'POST', token: cliente, corpo: { texto: 'Oi, as compras estão no caixa 3' } });
  const msgs = await call(`/v2/corridas/${corridaId}/mensagens`, { metodo: 'POST', token: motorista, corpo: { texto: 'Chegando!' } });
  assert.deepEqual(
    msgs.d.map((m) => m.autor),
    ['cliente', 'motorista'],
  );
  assert.equal((await call(`/v2/corridas/${corridaId}/mensagens?depois=${msgs.d[0].id}`, { token: cliente })).d.length, 1);

  // pagamento só quando o motorista chega ao mercado
  assert.equal((await call(`/v2/corridas/${corridaId}/entregue`, { metodo: 'POST', token: motorista })).s, 409);
  const ch = await call(`/v2/corridas/${corridaId}/cheguei`, { metodo: 'POST', token: motorista });
  assert.equal(ch.d.status, 'aguardando_pagamento');
  assert.equal((await call(`/v2/corridas/${corridaId}`, { token: cliente })).d.checkoutUrl, 'https://checkout.infinitepay.io/loja?lenc=x');

  const ret = await call(`/retorno?order_nsu=${corridaId}&slug=s1&transaction_nsu=t1&receipt_url=https%3A%2F%2Fr`);
  assert.match(ret.d, /Pagamento confirmado!/);
  assert.match(zaps.at(-1), /PAGO/);
  const pago = await call(`/v2/corridas/${corridaId}`, { token: cliente });
  assert.equal(pago.d.status, 'pago');

  assert.equal((await call(`/v2/corridas/${corridaId}/entregue`, { metodo: 'POST', token: motorista })).d.status, 'entregue');
  const eu = await call('/v2/eu', { token: motorista });
  assert.equal(eu.d.aReceber, Math.round(pago.d.valor * 0.8 * 100) / 100);
});

test('agendado: horário bloqueado 40 min, cliente cancela e libera', async () => {
  avanca(60);
  await call('/v2/eu/livre', { metodo: 'POST', token: motorista });
  const dia = (await call('/v2/disponibilidade')).d.dias[1];
  const h = dia.horarios[2];
  const c = await call('/v2/corridas', { metodo: 'POST', token: cliente, corpo: { mercadoId: 'burei', agendado: true, inicio: h.inicio } });
  assert.equal(c.s, 200, JSON.stringify(c.d));
  const depois = (await call('/v2/disponibilidade')).d.dias.find((d) => d.data === dia.data).horarios.map((x) => x.hora);
  assert.ok(!depois.includes(h.hora)); // 1 motorista aprovado → horário ocupado
  assert.equal((await call(`/v2/corridas/${c.d.id}/cancelar`, { metodo: 'POST', token: cliente })).d.status, 'cancelado');
  assert.ok((await call('/v2/disponibilidade')).d.dias.find((d) => d.data === dia.data).horarios.some((x) => x.hora === h.hora));
});

test('cliente não paga com o motorista no mercado → taxa de deslocamento na próxima', async () => {
  // 1 h sem enviar posição: o servidor deixou o motorista offline; ele volta a ficar online.
  await call('/v2/eu/online', { metodo: 'POST', token: motorista, corpo: { online: true, lat: -26.47, lon: -48.98 } });
  const c = await call('/v2/corridas', { metodo: 'POST', token: cliente, corpo: { mercadoId: 'martini', agendado: false } });
  assert.equal(c.s, 200, JSON.stringify(c.d));
  await call(`/v2/ofertas/${c.d.id}/aceitar`, { metodo: 'POST', token: motorista });
  await call(`/v2/corridas/${c.d.id}/cheguei`, { metodo: 'POST', token: motorista });
  assert.equal((await call(`/v2/corridas/${c.d.id}/nao-pagou`, { metodo: 'POST', token: motorista })).s, 409); // espera mínima
  avanca(16); // passou o prazo de 15 min
  await call('/v2/eu/local', { metodo: 'POST', token: motorista, corpo: { lat: -26.47, lon: -48.98 } });
  const st = await call(`/v2/corridas/${c.d.id}`, { token: cliente });
  assert.equal(st.d.status, 'cancelado');
  assert.equal(st.d.motivo, 'nao_pagou');
  assert.equal((await call('/v2/eu', { token: cliente })).d.taxaPendente, 5);
  assert.match(zaps.at(-1), /taxa de R\$ 5,00/);

  // próxima corrida cobra frete + taxa
  avanca(40);
  await call('/v2/eu/livre', { metodo: 'POST', token: motorista });
  await call('/v2/eu/online', { metodo: 'POST', token: motorista, corpo: { online: true, lat: -26.47, lon: -48.98 } });
  const n = await call('/v2/corridas', { metodo: 'POST', token: cliente, corpo: { mercadoId: 'cooper', agendado: false } });
  assert.equal(n.s, 200, JSON.stringify(n.d));
  await call(`/v2/ofertas/${n.d.id}/aceitar`, { metodo: 'POST', token: motorista });
  await call(`/v2/corridas/${n.d.id}/cheguei`, { metodo: 'POST', token: motorista });
  assert.equal(linkCriado.items.length, 2);
  assert.equal(linkCriado.items[1].price, 500);
  await call(`/retorno?order_nsu=${n.d.id}&slug=s2&transaction_nsu=t2`);
  assert.equal((await call('/v2/eu', { token: cliente })).d.taxaPendente, 0);
});

test('admin: resumo, repasse ao motorista, configuração e senha', async () => {
  assert.equal((await call('/v2/admin/resumo')).s, 401);
  const r = await call('/v2/admin/resumo', { token: ADM });
  assert.ok(r.d.aRepassar > 0);
  const mot = (await call('/v2/admin/motoristas', { token: ADM })).d[0];
  const rep = await call(`/v2/admin/motoristas/${mot.id}/repasse`, { metodo: 'POST', token: ADM });
  assert.equal(rep.d.corridas, 2);
  assert.equal((await call('/v2/eu', { token: motorista })).d.aReceber, 0);
  const cfg = await call('/v2/admin/config', { metodo: 'PUT', token: ADM, corpo: { comissaoMotoristaPct: 75, taxaDeslocamento: 7 } });
  assert.equal(cfg.d.comissaoMotoristaPct, 75);
  assert.equal((await call('/v2/config')).d.taxaDeslocamento, 7);
  assert.equal((await call('/v2/admin/config', { metodo: 'PUT', token: ADM, corpo: { comissaoMotoristaPct: 120 } })).s, 400);
  const link = (await call('/v2/admin/agenda-link', { token: ADM })).d.url;
  assert.match((await call(link.replace(B, ''))).d, /TRIGGER:-PT15M/);
});
