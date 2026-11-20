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
const COOPER = { lat: -26.471870, lon: -48.976217 }; // posição do mercado
const LONGE = { lat: -26.49, lon: -49.01 };

// Relógio fixo: segunda 23/11/2026, 10:00 em Brasília.
let relogio = Date.parse('2026-11-23T13:00:00Z');
Date.now = () => relogio;
const avanca = (min) => (relogio += min * 60_000);
const pagar = (id, n = id) => call(`/retorno?order_nsu=${id}&slug=s-${n}&transaction_nsu=t-${n}`);
const online = (token, p = COOPER) => call('/v2/eu/online', { metodo: 'POST', token, corpo: { online: true, ...p } });

let cliente, motorista, motId;

test('cadastros, documentos, aprovação; Pix do motorista = CPF', async () => {
  const c = await call('/v2/clientes', { metodo: 'POST', corpo: { nome: 'Ana Souza', cpf: '529.982.247-25', telefone: '(47) 98888-7777', endereco: 'Rua X, 10, Corticeira', lat: -26.4893, lon: -48.9872 } });
  assert.equal(c.s, 200, JSON.stringify(c.d));
  cliente = c.d.token;
  const m = await call('/v2/motoristas', { metodo: 'POST', corpo: { nome: 'Smaylei Luiz', cpf: '153.509.460-56', telefone: '47999149325', carro: 'Fiat Strada', placa: 'abc-1d23', cor: 'Branca' } });
  assert.equal(m.s, 200, JSON.stringify(m.d));
  motorista = m.d.token;
  assert.equal((await online(motorista)).s, 403); // não aprovado
  await call('/v2/arquivos?tipo=selfie', { metodo: 'POST', token: motorista, bruto: JPG, tipo: 'image/jpeg' });
  const lista = await call('/v2/admin/motoristas', { token: ADM });
  motId = lista.d[0].id;
  await call(`/v2/admin/motoristas/${motId}/status`, { metodo: 'POST', token: ADM, corpo: { status: 'aprovado' } });
  assert.equal((await online(motorista)).s, 403); // falta CNH
  await call('/v2/arquivos?tipo=cnh', { metodo: 'POST', token: motorista, bruto: JPG, tipo: 'image/jpeg' });
  assert.equal((await online(motorista)).s, 200);
  assert.equal((await call('/v2/eu', { token: motorista })).d.pix, '15350946056');
});

test('fluxo completo: paga ao pedir (retido) → aceite → GPS no local → cliente confirma (libera) → entregue', async () => {
  const c = await call('/v2/corridas', { metodo: 'POST', token: cliente, corpo: { mercadoId: 'cooper', agendado: false } });
  assert.equal(c.s, 200, JSON.stringify(c.d));
  assert.equal(c.d.status, 'pagamento_pendente');
  assert.ok(c.d.checkoutUrl);
  assert.equal((await call('/v2/ofertas', { token: motorista })).d.length, 0); // sem pagamento, sem oferta

  await pagar(c.d.id);
  assert.equal((await call(`/v2/corridas/${c.d.id}`, { token: cliente })).d.status, 'buscando');
  assert.match(zaps.at(-1), /PAGO.*retido/);
  assert.equal((await call('/v2/admin/resumo', { token: ADM })).d.retido, c.d.valor);

  const of = await call('/v2/ofertas', { token: motorista });
  assert.equal(of.d.length, 1);
  assert.equal((await call(`/v2/ofertas/${c.d.id}/aceitar`, { metodo: 'POST', token: motorista })).d.status, 'aceito');
  const ganho = Math.round(c.d.valor * 0.8 * 100) / 100;
  assert.equal((await call('/v2/saldo', { token: motorista })).d.emLiberacao, ganho);
  assert.equal((await call('/v2/saldo', { token: motorista })).d.disponivel, 0);

  // "Cheguei" longe do mercado é recusado (antifraude por GPS)
  const longe = await call(`/v2/corridas/${c.d.id}/cheguei`, { metodo: 'POST', token: motorista, corpo: LONGE });
  assert.equal(longe.s, 409);
  assert.match(longe.d.erro, /Você está a \d+ m/);
  assert.equal((await call(`/v2/corridas/${c.d.id}/entregue`, { metodo: 'POST', token: motorista })).s, 409);
  assert.equal((await call(`/v2/corridas/${c.d.id}/cheguei`, { metodo: 'POST', token: motorista, corpo: COOPER })).d.status, 'no_local');
  assert.equal((await call(`/v2/corridas/${c.d.id}/entregue`, { metodo: 'POST', token: motorista })).s, 409); // falta o cliente confirmar

  const conf = await call(`/v2/corridas/${c.d.id}/confirmar-motorista`, { metodo: 'POST', token: cliente });
  assert.equal(conf.d.status, 'em_andamento');
  const s = (await call('/v2/saldo', { token: motorista })).d;
  assert.equal(s.disponivel, ganho);
  assert.equal(s.emLiberacao, 0);

  const ent = await call(`/v2/corridas/${c.d.id}/entregue`, { metodo: 'POST', token: motorista });
  assert.equal(ent.s, 200, JSON.stringify(ent.d));
  assert.equal(ent.d.status, 'entregue');
});

test('saque semanal: pede, admin vê a ordem com Pix CPF, marca pago; segundo saque só depois de 7 dias', async () => {
  const s0 = (await call('/v2/saldo', { token: motorista })).d;
  const sq = await call('/v2/saques', { metodo: 'POST', token: motorista });
  assert.equal(sq.s, 200, JSON.stringify(sq.d));
  assert.equal(sq.d.valor, s0.disponivel);
  assert.match(zaps.at(-1), /SAQUE SOLICITADO[\s\S]*15350946056/);
  assert.equal((await call('/v2/saldo', { token: motorista })).d.disponivel, 0);
  const ordens = await call('/v2/admin/saques', { token: ADM });
  assert.equal(ordens.d[0].chave_pix, '15350946056');
  assert.equal((await call('/v2/admin/resumo', { token: ADM })).d.saquesPendentesQtd, 1);
  await call(`/v2/admin/saques/${ordens.d[0].id}/pagar`, { metodo: 'POST', token: ADM });
  assert.equal((await call('/v2/admin/saques', { token: ADM })).d[0].status, 'pago');
  assert.equal((await call('/v2/saques', { metodo: 'POST', token: motorista })).s, 409); // semana ainda não passou
});

test('cliente cancela com o motorista no local: taxa ao motorista, resto estornado', async () => {
  avanca(60);
  await call('/v2/eu/livre', { metodo: 'POST', token: motorista });
  await online(motorista);
  const c = await call('/v2/corridas', { metodo: 'POST', token: cliente, corpo: { mercadoId: 'cooper', agendado: false } });
  assert.equal(c.s, 200, JSON.stringify(c.d));
  await pagar(c.d.id);
  await call(`/v2/ofertas/${c.d.id}/aceitar`, { metodo: 'POST', token: motorista });
  await call(`/v2/corridas/${c.d.id}/cheguei`, { metodo: 'POST', token: motorista, corpo: COOPER });
  const canc = await call(`/v2/corridas/${c.d.id}/cancelar`, { metodo: 'POST', token: cliente });
  assert.equal(canc.d.status, 'cancelado');
  assert.equal(canc.d.taxaAplicada, 5);
  assert.equal(canc.d.reembolso, Math.round((c.d.valor - 5) * 100) / 100);
  assert.equal((await call('/v2/saldo', { token: motorista })).d.disponivel, 5);
  const est = await call('/v2/admin/estornos', { token: ADM });
  assert.equal(est.d[0].reembolso, canc.d.reembolso);
  await call(`/v2/admin/estornos/${c.d.id}/feito`, { metodo: 'POST', token: ADM });
  assert.equal((await call('/v2/admin/resumo', { token: ADM })).d.estornosPendentesQtd, 0);
});

test('sem motorista no prazo → cancelada com estorno total; agendado bloqueia horário e libera ao cancelar', async () => {
  avanca(60);
  await call('/v2/eu/livre', { metodo: 'POST', token: motorista });
  await online(motorista);
  const c = await call('/v2/corridas', { metodo: 'POST', token: cliente, corpo: { mercadoId: 'burei', agendado: false } });
  await pagar(c.d.id);
  await call(`/v2/ofertas/${c.d.id}/recusar`, { metodo: 'POST', token: motorista });
  avanca(6);
  const st = await call(`/v2/corridas/${c.d.id}`, { token: cliente });
  assert.equal(st.d.status, 'cancelado');
  assert.equal(st.d.motivo, 'sem_motorista');
  assert.equal(st.d.reembolso, c.d.valor);
  assert.match(zaps.at(-1), /ESTORNAR/);

  const dia = (await call('/v2/disponibilidade')).d.dias[1];
  const h = dia.horarios[2];
  const ag = await call('/v2/corridas', { metodo: 'POST', token: cliente, corpo: { mercadoId: 'burei', agendado: true, inicio: h.inicio } });
  assert.equal(ag.s, 200, JSON.stringify(ag.d));
  const ocupados = (await call('/v2/disponibilidade')).d.dias.find((d) => d.data === dia.data).horarios.map((x) => x.hora);
  assert.ok(!ocupados.includes(h.hora)); // reservado enquanto paga
  await call(`/v2/corridas/${ag.d.id}/cancelar`, { metodo: 'POST', token: cliente });
  assert.ok((await call('/v2/disponibilidade')).d.dias.find((d) => d.data === dia.data).horarios.some((x) => x.hora === h.hora));
});

test('pedido não pago expira em 15 min e libera o horário', async () => {
  const dia = (await call('/v2/disponibilidade')).d.dias[2];
  const h = dia.horarios[0];
  const ag = await call('/v2/corridas', { metodo: 'POST', token: cliente, corpo: { mercadoId: 'martini', agendado: true, inicio: h.inicio } });
  assert.equal(ag.s, 200);
  avanca(16);
  assert.equal((await call(`/v2/corridas/${ag.d.id}`, { token: cliente })).d.status, 'cancelado');
  assert.ok((await call('/v2/disponibilidade')).d.dias.find((d) => d.data === dia.data).horarios.some((x) => x.hora === h.hora));
});

test('admin: configuração reflete para clientes e motoristas; agenda .ics; senha', async () => {
  assert.equal((await call('/v2/admin/resumo')).s, 401);
  await call('/v2/admin/config', { metodo: 'PUT', token: ADM, corpo: { comissaoMotoristaPct: 75, taxaDeslocamento: 7, aberto: false } });
  const pub = (await call('/v2/config')).d;
  assert.equal(pub.taxaDeslocamento, 7);
  assert.equal(pub.comissaoMotoristaPct, 75);
  assert.equal(pub.aberto, false);
  assert.equal((await call('/v2/eu', { token: motorista })).d.comissaoPct, 75);
  assert.equal((await call('/v2/disponibilidade')).d.agora.ok, false);
  assert.equal((await call('/v2/admin/config', { metodo: 'PUT', token: ADM, corpo: { comissaoMotoristaPct: 120 } })).s, 400);
  const link = (await call('/v2/admin/agenda-link', { token: ADM })).d.url;
  assert.match((await call(link.replace(B, ''))).d, /TRIGGER:-PT15M/);
});
