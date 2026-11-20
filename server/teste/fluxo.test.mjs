// Teste de ponta a ponta do Worker com InfinitePay e WhatsApp simulados.
// Rodar: npm test (na pasta server)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../.teste/worker.mjs';

const kv = new Map();
const env = {
  INFINITEPAY_HANDLE: 'loja', ADMIN_TOKEN: 'senha', APP_SCHEME: 'mercadofrete', WHATSAPP_PHONE: '+5547999990000', CALLMEBOT_APIKEY: 'k',
  PEDIDOS: {
    get: async (k) => (kv.has(k) ? JSON.parse(kv.get(k)) : null),
    put: async (k, v) => void kv.set(k, v),
    list: async ({ prefix }) => ({ keys: [...kv.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
  },
};
const zaps = [];
const pend = [];
const ctx = { waitUntil: (p) => pend.push(p) };
globalThis.fetch = async (url, init) => {
  url = String(url);
  if (url.endsWith('/links')) return new Response(JSON.stringify({ url: 'https://checkout.infinitepay.io/loja?lenc=x' }));
  if (url.endsWith('/payment_check')) return new Response(JSON.stringify({ success: true, paid: true, capture_method: 'pix' }));
  if (url.startsWith('https://api.callmebot.com/')) { zaps.push(decodeURIComponent(new URL(url).searchParams.get('text'))); return new Response('ok'); }
  throw new Error('fetch inesperado ' + url);
};
const B = 'https://srv.test';
const call = async (path, opt = {}) => {
  const r = await worker.fetch(new Request(B + path, { ...opt, body: opt.body ? JSON.stringify(opt.body) : undefined }), env, ctx);
  await Promise.all(pend.splice(0));
  const t = await r.text();
  try { return { s: r.status, d: JSON.parse(t) }; } catch { return { s: r.status, d: t }; }
};
const admin = { authorization: 'Bearer senha' };
const cliente = { nome: 'Ana', endereco: 'Rua X, 10', telefone: '+5547988887777', lat: -26.4893, lon: -48.9872 };

test('agendar, pagar, avisar, cancelar e liberar o horário', async () => {
  const disp = await call('/disponibilidade');
  assert.equal(disp.s, 200);
  const dia = disp.d.dias.at(-1); // um dia à frente, sempre aberto
  const h = dia.horarios[3];

  const c1 = await call('/pedidos', { method: 'POST', body: { mercadoId: 'cooper', agendado: true, inicio: h.inicio, cliente } });
  assert.equal(c1.s, 200, JSON.stringify(c1.d));
  assert.ok(c1.d.cancelToken);

  // mesmo horário (e o seguinte, dentro dos 40 min) não pode ser reservado de novo
  assert.equal((await call('/pedidos', { method: 'POST', body: { mercadoId: 'burei', agendado: true, inicio: h.inicio, cliente } })).s, 409);
  assert.equal((await call('/pedidos', { method: 'POST', body: { mercadoId: 'burei', agendado: true, inicio: dia.horarios[4].inicio, cliente } })).s, 409);
  const depois = (await call('/disponibilidade')).d.dias.find((d) => d.data === dia.data).horarios.map((x) => x.hora);
  assert.ok(!depois.includes(h.hora) && !depois.includes(dia.horarios[4].hora) && depois.includes(dia.horarios[5].hora));

  // pagamento confirmado → WhatsApp com os dados
  const ret = await call(`/retorno?order_nsu=${c1.d.orderNsu}&slug=s1&transaction_nsu=t1&receipt_url=https%3A%2F%2Fr`);
  assert.match(ret.d, /Frete confirmado!/);
  assert.equal(zaps.length, 1);
  assert.match(zaps[0], /NOVO FRETE AGENDADO/);
  assert.match(zaps[0], /Ana · \+5547988887777/);
  assert.match(zaps[0], /calendar\.google\.com/);

  // agenda .ics com lembrete de 15 min
  const link = (await call('/admin/agenda-link', { headers: admin })).d.url;
  const cal = await call(link.replace(B, ''));
  assert.match(cal.d, /TRIGGER:-PT15M/);
  assert.match(cal.d, new RegExp(`UID:${c1.d.orderNsu}`));
  assert.equal((await call('/agenda.ics?k=errada')).s, 403);

  // cliente cancela → horário volta a ficar vago e o dono é avisado para estornar
  assert.equal((await call(`/pedidos/${c1.d.orderNsu}/cancelar`, { method: 'POST', body: { token: 'errado' } })).s, 403);
  const canc = await call(`/pedidos/${c1.d.orderNsu}/cancelar`, { method: 'POST', body: { token: c1.d.cancelToken } });
  assert.equal(canc.d.status, 'cancelado');
  assert.match(zaps[1], /FRETE CANCELADO \(pelo cliente\)/);
  assert.match(zaps[1], /Estornar/);
  const livres = (await call('/disponibilidade')).d.dias.find((d) => d.data === dia.data).horarios.map((x) => x.hora);
  assert.ok(livres.includes(h.hora));
});

test('admin: senha, fechar/abrir pedidos, Estou livre e tarifas no servidor', async () => {
  assert.equal((await call('/admin/pedidos')).s, 401);
  const lista = await call('/admin/pedidos', { headers: admin });
  assert.equal(lista.s, 200);
  assert.ok(lista.d.length >= 1);

  await call('/admin/config', { method: 'PUT', headers: admin, body: { aberto: false } });
  assert.equal((await call('/disponibilidade')).d.dias.length, 0);
  assert.equal((await call('/disponibilidade')).d.agora.ok, false);

  const livre = await call('/admin/livre', { method: 'POST', headers: admin });
  assert.equal(livre.d.ok, true);
  assert.equal((await call('/admin/status', { headers: admin })).d.config.aberto, true);

  const tar = (await call('/config')).d.tarifas;
  tar[0].porKm = 2;
  await call('/admin/config', { method: 'PUT', headers: admin, body: { tarifas: tar, bloqueioMin: 50 } });
  const cfg = (await call('/config')).d;
  assert.equal(cfg.tarifas[0].porKm, 2);
  assert.equal(cfg.bloqueioMin, 50);
  assert.equal((await call('/admin/config', { method: 'PUT', headers: admin, body: { bloqueioMin: 1 } })).s, 400);
});
