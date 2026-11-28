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
  PAGARME_SECRET_KEY: 'sk_test_movi',
  ADMIN_TOKEN: 'senha-admin',
  APP_SCHEME: 'mercadofrete',
  DOCS: {
    put: async (k, v, o) => void arquivos.set(k, { v, ct: o?.httpMetadata?.contentType }),
    get: async (k) => (arquivos.has(k) ? { body: arquivos.get(k).v, httpMetadata: { contentType: arquivos.get(k).ct } } : null),
    delete: async (k) => void arquivos.delete(k),
  },
};
const central = new Central(ctx, env);
env.CENTRAL = { idFromName: () => 'x', get: () => ({ fetch: (r) => central.fetch(r) }) };
let linkCriado;
// Pagar.me simulada (sandbox): pedidos, estornos e recebedores.
const pg = { pedidos: new Map(), estornos: [], recebedores: new Map(), ultimo: null, n: 0, cartoesExcluidos: [], tds: 0 };
const respPg = (d, status = 200) => new Response(JSON.stringify(d), { status });
globalThis.fetch = async (url, init) => {
  url = String(url);
  if (url === 'https://3ds-sdx.stone.com.br/v2/tds-token') {
    assert.match(init.headers.authorization, /^Basic /);
    pg.tds++;
    return respPg({ tds_token: 'tds_tok_' + pg.tds });
  }
  if (url.startsWith('https://sdx-api.pagar.me/core/v5')) {
    const caminho = url.slice('https://sdx-api.pagar.me/core/v5'.length);
    assert.match(init.headers.authorization, /^Basic /);
    const corpo = init.body ? JSON.parse(init.body) : {};
    if (init.method === 'POST' && caminho === '/orders') {
      pg.ultimo = corpo;
      const id = `or_${++pg.n}`, ch = `ch_${pg.n}`;
      const pay = corpo.payments[0];
      const dc = pay.credit_card ?? pay.debit_card;
      const cartao = !!dc;
      const recusado = cartao && dc.card_token === 'tok_recusado';
      const status = cartao ? (recusado ? 'failed' : 'paid') : 'pending';
      pg.pedidos.set(id, { status, ch });
      const card = cartao ? { id: dc.card_id ?? `card_${pg.n}`, brand: 'Mastercard', last_four_digits: '5100', exp_month: 8, exp_year: 2029 } : undefined;
      return respPg({ id, status, customer: { id: corpo.customer_id ?? `cus_${corpo.customer?.code}` }, charges: [{ id: ch, status, last_transaction: cartao ? { status: recusado ? 'not_authorized' : 'captured', acquirer_message: recusado ? 'Transação não autorizada' : undefined, card } : { qr_code: '00020126PIXMOVI', qr_code_url: 'https://api.pagar.me/qr.png', expires_at: new Date(Date.now() + 600000).toISOString() } }] });
    }
    const om = caminho.match(/^\/orders\/(\w+)$/);
    if (init.method === 'GET' && om) {
      const o = pg.pedidos.get(om[1]);
      return respPg({ id: om[1], status: o.status, charges: [{ id: o.ch, status: o.status }] });
    }
    const km = caminho.match(/^\/customers\/([\w-]+)\/cards\/([\w-]+)$/);
    if (init.method === 'DELETE' && km) {
      pg.cartoesExcluidos.push(km[2]);
      return respPg({ id: km[2], status: 'deleted' });
    }
    const cm = caminho.match(/^\/charges\/(\w+)$/);
    if (init.method === 'DELETE' && cm) {
      pg.estornos.push({ charge: cm[1], amount: corpo.amount });
      return respPg({ id: cm[1], status: 'refunded' });
    }
    if (init.method === 'POST' && caminho === '/recipients') {
      const id = `rp_${++pg.n}`;
      pg.recebedores.set(id, { status: 'registration', corpo });
      return respPg({ id, status: 'registration' });
    }
    const rm = caminho.match(/^\/recipients\/(\w+)(\/kyc_link)?$/);
    if (rm && rm[2]) return respPg({ url: 'pagar.me/kyc/abc123', expires_at: new Date(Date.now() + 86400000).toISOString() });
    if (rm) return respPg({ id: rm[1], status: pg.recebedores.get(rm[1]).status });
    throw new Error('Pagar.me: rota inesperada ' + init.method + ' ' + caminho);
  }
  if (url.endsWith('/links')) {
    linkCriado = JSON.parse(init.body);
    return new Response(JSON.stringify({ url: 'https://checkout.infinitepay.io/loja?lenc=x' }));
  }
  if (url.endsWith('/payment_check')) return new Response(JSON.stringify({ success: true, paid: true, capture_method: 'pix' }));
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
const ultimoAviso = async () => (await call('/v2/admin/avisos', { token: ADM })).d.avisos[0]?.texto ?? '';
const JPG = new Uint8Array(5000).fill(1);
const COOPER = { lat: -26.471870, lon: -48.976217 }; // posição do mercado
const LONGE = { lat: -26.49, lon: -49.01 };

// Relógio fixo: segunda 23/11/2026, 10:00 em Brasília.
let relogio = Date.parse('2026-11-23T13:00:00Z');
Date.now = () => relogio;
const avanca = (min) => (relogio += min * 60_000);
const pagar = (id, n = id) => call(`/retorno?order_nsu=${id}&slug=s-${n}&transaction_nsu=t-${n}`);
// Ganho do motorista: 80% do frete sem a taxa de urgência + incentivo (R$ 4, no máximo a urgência).
const ganhoEsperado = async (id) => {
  const c = (await call('/v2/admin/corridas', { token: ADM })).d.find((x) => x.id === id);
  const urg = Number(c.urgencia || 0);
  return Math.round((((c.valor - urg) * 80) / 100 + (urg > 0 ? Math.min(4, urg) : 0)) * 100) / 100;
};
const online = (token, p = COOPER) => call('/v2/eu/online', { metodo: 'POST', token, corpo: { online: true, ...p } });

let cliente, motorista, motId, entregueId;

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
  assert.match(await ultimoAviso(), /PAGO.*retido/);
  assert.equal((await call('/v2/admin/resumo', { token: ADM })).d.retido, c.d.valor);

  const of = await call('/v2/ofertas', { token: motorista });
  assert.equal(of.d.length, 1);
  // o motorista não vê o valor pago pelo cliente nem a taxa de urgência: só o que ele recebe
  const ganho = await ganhoEsperado(c.d.id);
  const urg = (await call('/v2/admin/corridas', { token: ADM })).d.find((x) => x.id === c.d.id).urgencia;
  assert.ok(urg > 0, 'pedido agora tem taxa de urgência');
  assert.equal(of.d[0].ganho, ganho);
  assert.equal(of.d[0].valor, ganho);
  assert.equal(of.d[0].incentivo, Math.min(4, urg));
  assert.equal((await call(`/v2/ofertas/${c.d.id}/aceitar`, { metodo: 'POST', token: motorista })).d.status, 'aceito');
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

  // chat interno: cliente, motorista e suporte; motorista não recebe o telefone do cliente
  assert.equal(of.d[0].cliente.telefone, null);
  await call(`/v2/corridas/${c.d.id}/mensagens`, { metodo: 'POST', token: cliente, corpo: { texto: 'Estou no caixa 3' } });
  assert.match(await ultimoAviso(), /Mensagem do cliente/);
  await call(`/v2/admin/corridas/${c.d.id}/mensagens`, { metodo: 'POST', token: ADM, corpo: { texto: 'Suporte aqui, tudo certo?' } });
  const chat = await call(`/v2/corridas/${c.d.id}/mensagens`, { metodo: 'POST', token: motorista, corpo: { texto: 'Chegando' } });
  assert.deepEqual(chat.d.map((m) => m.autor), ['cliente', 'suporte', 'motorista']);
  const av = await call('/v2/admin/avisos', { token: ADM });
  assert.ok(av.d.naoLidos > 0);
  await call('/v2/admin/avisos/lidos', { metodo: 'POST', token: ADM });
  assert.equal((await call('/v2/admin/avisos', { token: ADM })).d.naoLidos, 0);

  const ent = await call(`/v2/corridas/${c.d.id}/entregue`, { metodo: 'POST', token: motorista });
  assert.equal(ent.s, 200, JSON.stringify(ent.d));
  assert.equal(ent.d.status, 'entregue');
  entregueId = c.d.id;
});

test('fim do atendimento: avaliação + sugestão (só o admin lê) e gorjeta 100% ao motorista, Pix ou cartão', async () => {
  const id = entregueId;
  const antes = (await call('/v2/saldo', { token: motorista })).d.disponivel;
  assert.equal((await call(`/v2/corridas/${id}/avaliar`, { metodo: 'POST', token: cliente, corpo: { nota: 9 } })).s, 400);
  const av = await call(`/v2/corridas/${id}/avaliar`, { metodo: 'POST', token: cliente, corpo: { nota: 5, sugestao: 'Poderia avisar quando sair do mercado' } });
  assert.equal(av.s, 200, JSON.stringify(av.d));
  assert.equal(av.d.avaliacao, 5);
  assert.equal((await call(`/v2/corridas/${id}/avaliar`, { metodo: 'POST', token: cliente, corpo: { nota: 1 } })).s, 409); // uma vez só
  assert.match(await ultimoAviso(), /AVALIAÇÃO 5\/5[\s\S]*Sugestão: Poderia avisar/);

  // gorjeta: link próprio, só Pix e cartão (com a API Key)
  env.INFINITEPAY_API_KEY = 'chave-teste';
  assert.equal((await call(`/v2/corridas/${id}/gorjeta`, { metodo: 'POST', token: cliente, corpo: { valor: 500 } })).s, 400);
  const g = await call(`/v2/corridas/${id}/gorjeta`, { metodo: 'POST', token: cliente, corpo: { valor: 5 } });
  delete env.INFINITEPAY_API_KEY;
  assert.equal(g.s, 200, JSON.stringify(g.d));
  assert.ok(g.d.checkoutUrl);
  assert.equal(linkCriado.order_nsu, g.d.id);
  assert.equal(linkCriado.items[0].price, 500);
  assert.deepEqual(linkCriado.options.payment_methods_enabled, ['pix', 'credit_card']);
  assert.equal(linkCriado.options.assured_installments, 0);
  assert.equal((await call(`/v2/gorjetas/${g.d.id}`, { token: cliente })).d.status, 'pendente');
  assert.equal((await call(`/v2/gorjetas/${g.d.id}`, { token: motorista })).s, 404);

  const ret = await pagar(g.d.id);
  assert.match(ret.d, /Obrigado pela gorjeta/);
  assert.equal((await call(`/v2/gorjetas/${g.d.id}`, { token: cliente })).d.status, 'paga');
  await pagar(g.d.id); // repetido não credita duas vezes
  const s = (await call('/v2/saldo', { token: motorista })).d;
  assert.equal(s.disponivel, Math.round((antes + 5) * 100) / 100);
  assert.equal(s.creditos[0].tipo, 'gorjeta');
  assert.equal((await call(`/v2/corridas/${id}`, { token: cliente })).d.gorjeta, 5);
  assert.equal((await call(`/v2/corridas/${id}/gorjeta`, { metodo: 'POST', token: cliente, corpo: { valor: 2 } })).s, 409);
  assert.match(await ultimoAviso(), /GORJETA de R\$ 5,00/);

  // motorista vê a média e a gorjeta, nunca a sugestão
  const eu = (await call('/v2/eu', { token: motorista })).d;
  assert.equal(eu.notaMedia, 5);
  assert.equal(eu.gorjetasTotal, 5);
  const hist = (await call('/v2/historico', { token: motorista })).d;
  assert.equal(hist.find((c) => c.id === id).gorjeta, 5);
  assert.ok(!JSON.stringify(hist).includes('Poderia avisar'));

  const adm = (await call('/v2/admin/avaliacoes', { token: ADM })).d;
  assert.equal(adm.media, 5);
  assert.equal(adm.avaliacoes[0].sugestao, 'Poderia avisar quando sair do mercado');
  assert.equal(adm.avaliacoes[0].gorjeta, 5);
  assert.equal(adm.avaliacoes[0].lida, 0);
  assert.equal((await call('/v2/admin/resumo', { token: ADM })).d.avaliacoesNaoLidas, 1);
  await call('/v2/admin/avaliacoes/lidas', { metodo: 'POST', token: ADM });
  assert.equal((await call('/v2/admin/resumo', { token: ADM })).d.avaliacoesNaoLidas, 0);
});

test('saque semanal: pede, admin vê a ordem com Pix CPF, marca pago; segundo saque só depois de 7 dias', async () => {
  const s0 = (await call('/v2/saldo', { token: motorista })).d;
  const sq = await call('/v2/saques', { metodo: 'POST', token: motorista });
  assert.equal(sq.s, 200, JSON.stringify(sq.d));
  assert.equal(sq.d.valor, s0.disponivel);
  assert.match(await ultimoAviso(), /SAQUE SOLICITADO[\s\S]*15350946056/);
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
  assert.match(await ultimoAviso(), /ESTORNAR/);

  const dia = (await call('/v2/disponibilidade')).d.dias[1];
  const h = dia.horarios[2];
  const ag = await call('/v2/corridas', { metodo: 'POST', token: cliente, corpo: { mercadoId: 'burei', agendado: true, inicio: h.inicio } });
  assert.equal(ag.s, 200, JSON.stringify(ag.d));
  const ocupados = (await call('/v2/disponibilidade')).d.dias.find((d) => d.data === dia.data).horarios.map((x) => x.hora);
  assert.ok(!ocupados.includes(h.hora)); // reservado enquanto paga
  assert.equal((await call('/v2/agenda-disponivel', { token: motorista })).d.length, 0); // ainda não pago
  await pagar(ag.d.id);
  const agDisp = await call('/v2/agenda-disponivel', { token: motorista });
  assert.equal(agDisp.d[0].data, dia.data);
  assert.equal(agDisp.d[0].corridas[0].id, ag.d.id);
  await call(`/v2/corridas/${ag.d.id}/cancelar`, { metodo: 'POST', token: cliente });
  assert.ok((await call('/v2/disponibilidade')).d.dias.find((d) => d.data === dia.data).horarios.some((x) => x.hora === h.hora));
  assert.equal((await call('/v2/agenda-disponivel', { token: motorista })).d.length, 0);
});

test('agenda de corridas: parceiro aceita uma corrida de outro dia e ela vai para a agenda dele', async () => {
  const dia = (await call('/v2/disponibilidade')).d.dias[3];
  const h = dia.horarios[5];
  const ag = await call('/v2/corridas', { metodo: 'POST', token: cliente, corpo: { mercadoId: 'cooper', agendado: true, inicio: h.inicio } });
  await pagar(ag.d.id);
  assert.equal((await call(`/v2/ofertas/${ag.d.id}/aceitar`, { metodo: 'POST', token: motorista })).d.status, 'aceito');
  const minha = await call('/v2/agenda', { token: motorista });
  assert.ok(minha.d.some((c) => c.id === ag.d.id));
  assert.ok(!(await call('/v2/agenda-disponivel', { token: motorista })).d.some((d) => d.corridas.some((c) => c.id === ag.d.id)));
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

test('serviços: locais por categoria, só buscar (cliente confirma o recebimento), encomenda, borracharia, admin cadastra locais', async () => {
  await call('/v2/admin/config', { metodo: 'PUT', token: ADM, corpo: { aberto: true, comissaoMotoristaPct: 80 } });
  // Lançamento: só mercados. O resto fica pronto, esperando o Admin liberar.
  const ini = (await call('/v2/config')).d;
  assert.deepEqual(ini.servicosAtivos, ['comigo', 'ir', 'buscar', 'loja_entrega', 'loja_cliente']);
  assert.deepEqual(ini.cidadesAtivas, ['guaramirim', 'jaragua', 'schroeder', 'massaranduba', 'joinville']);
  assert.ok(ini.locais.some((l) => l.cidade === 'joinville'));
  assert.deepEqual(ini.categoriasAtivas, ['mercado']);
  assert.ok(ini.locais.every((l) => l.categoria === 'mercado'));
  const c0 = await call('/v2/clientes', { metodo: 'POST', corpo: { nome: 'Davi Melo', cpf: '935.411.347-80', endereco: 'Rua W, 1, Centro', lat: -26.4750, lon: -49.0040 } });
  assert.equal(c0.s, 200, JSON.stringify(c0.d));
  const cli0 = c0.d.token;
  const negado = await call('/v2/corridas', { metodo: 'POST', token: cli0, corpo: { servico: 'encomenda', coleta: { endereco: 'Rua Roberto Ziemann, 100, Centro', lat: -26.4720, lon: -48.9960 }, descricao: 'Caixa', agendado: false } });
  assert.equal(negado.s, 403);
  assert.match((await call('/v2/corridas', { metodo: 'POST', token: cli0, corpo: { servico: 'buscar', coleta: { localId: 'farm-sesi' }, descricao: 'Remédio', agendado: false } })).d.erro, /apenas os mercados/);
  assert.match((await call('/v2/corridas', { metodo: 'POST', token: cli0, corpo: { servico: 'comigo', coleta: { endereco: 'Rua Roberto Ziemann, 100, Centro', lat: -26.4720, lon: -48.9960 }, agendado: false } })).d.erro, /apenas os mercados/);
  assert.equal((await call('/v2/admin/config', { metodo: 'PUT', token: ADM, corpo: { servicosAtivos: ['voar'] } })).s, 400);
  await call('/v2/admin/config', {
    metodo: 'PUT', token: ADM,
    corpo: { servicosAtivos: ['comigo', 'ir', 'buscar', 'encomenda', 'transporte', 'borracharia', 'loja_entrega', 'loja_cliente'], categoriasAtivas: ['mercado', 'padaria', 'farmacia', 'gas_bebidas', 'festa', 'mecanico', 'borracharia'], outroEnderecoLoja: true },
  });
  const cfg = (await call('/v2/config')).d;
  assert.ok(cfg.locais.some((l) => l.categoria === 'farmacia'));
  assert.ok(cfg.locais.some((l) => l.categoria === 'borracharia'));
  const farm = cfg.locais.find((l) => l.categoria === 'farmacia');

  const c2 = await call('/v2/clientes', { metodo: 'POST', corpo: { nome: 'Bia Lima', cpf: '111.444.777-35', endereco: 'Rua Y, 20, Centro', lat: -26.4740, lon: -49.0050 } });
  const cli2 = c2.d.token;
  await online(motorista, { lat: farm.lat, lon: farm.lon });

  // só buscar: descrição obrigatória
  assert.equal((await call('/v2/corridas', { metodo: 'POST', token: cli2, corpo: { servico: 'buscar', coleta: { localId: farm.id }, entrega: { casa: true }, agendado: false } })).s, 400);
  const bu = await call('/v2/corridas', { metodo: 'POST', token: cli2, corpo: { servico: 'buscar', coleta: { localId: farm.id }, entrega: { casa: true }, descricao: 'Pedido 55 em nome de Bia', agendado: false } });
  assert.equal(bu.s, 200, JSON.stringify(bu.d));
  assert.equal(bu.d.servico, 'buscar');
  assert.equal(bu.d.clienteNaColeta, false);
  assert.equal(bu.d.coleta.nome, farm.nome);
  await pagar(bu.d.id);
  const of = (await call('/v2/ofertas', { token: motorista })).d.find((o) => o.id === bu.d.id);
  assert.equal(of.descricao, 'Pedido 55 em nome de Bia');
  assert.equal(of.coleta.nome, farm.nome);
  await call(`/v2/ofertas/${bu.d.id}/aceitar`, { metodo: 'POST', token: motorista });
  assert.equal((await call(`/v2/corridas/${bu.d.id}/cheguei`, { metodo: 'POST', token: motorista, corpo: { lat: farm.lat, lon: farm.lon } })).d.status, 'no_local');
  assert.equal((await call(`/v2/corridas/${bu.d.id}/confirmar-motorista`, { metodo: 'POST', token: cli2 })).s, 409); // cliente não está lá
  assert.equal((await call(`/v2/corridas/${bu.d.id}/cliente-ausente`, { metodo: 'POST', token: motorista })).s, 409);
  assert.equal((await call(`/v2/corridas/${bu.d.id}/coletei`, { metodo: 'POST', token: motorista })).d.status, 'em_andamento');
  const antes = (await call('/v2/saldo', { token: motorista })).d;
  assert.ok(antes.emLiberacao > 0); // ainda retido
  assert.equal((await call(`/v2/corridas/${bu.d.id}/entregue`, { metodo: 'POST', token: motorista })).s, 409);
  assert.equal((await call(`/v2/corridas/${bu.d.id}/cheguei-destino`, { metodo: 'POST', token: motorista, corpo: LONGE })).s, 409);
  assert.ok((await call(`/v2/corridas/${bu.d.id}/cheguei-destino`, { metodo: 'POST', token: motorista, corpo: { lat: -26.4740, lon: -49.0050 } })).d.chegouDestinoEm);
  const rec = await call(`/v2/corridas/${bu.d.id}/confirmar-recebimento`, { metodo: 'POST', token: cli2 });
  assert.equal(rec.d.status, 'entregue');
  const depois = (await call('/v2/saldo', { token: motorista })).d;
  assert.equal(depois.disponivel, Math.round((antes.disponivel + (await ganhoEsperado(bu.d.id))) * 100) / 100);
  await call('/v2/eu/livre', { metodo: 'POST', token: motorista });

  // encomenda: endereço livre, fora da área é recusado
  const fora = await call('/v2/corridas', { metodo: 'POST', token: cli2, corpo: { servico: 'encomenda', coleta: { endereco: 'Rua XV de Novembro, 10, Curitiba', lat: -25.43, lon: -49.27 }, descricao: 'Caixa', agendado: false } });
  assert.equal(fora.s, 400);
  assert.match(fora.d.erro, /fora da região/);
  const enc = await call('/v2/corridas', { metodo: 'POST', token: cli2, corpo: { servico: 'encomenda', coleta: { endereco: 'Rua Roberto Ziemann, 100, Centro', lat: -26.4720, lon: -48.9960 }, descricao: 'Caixa média, falar com João', agendado: false } });
  assert.equal(enc.s, 200, JSON.stringify(enc.d));
  assert.equal(enc.d.coleta.endereco, 'Rua Roberto Ziemann, 100, Centro');
  // cliente não confirma: o motorista conclui depois de chegar (GPS) e esperar o prazo
  await pagar(enc.d.id);
  await call(`/v2/ofertas/${enc.d.id}/aceitar`, { metodo: 'POST', token: motorista });
  await call(`/v2/corridas/${enc.d.id}/cheguei`, { metodo: 'POST', token: motorista, corpo: { lat: -26.4720, lon: -48.9960 } });
  await call(`/v2/corridas/${enc.d.id}/coletei`, { metodo: 'POST', token: motorista });
  await call(`/v2/corridas/${enc.d.id}/cheguei-destino`, { metodo: 'POST', token: motorista, corpo: { lat: -26.4740, lon: -49.0050 } });
  assert.equal((await call(`/v2/corridas/${enc.d.id}/entregue`, { metodo: 'POST', token: motorista })).s, 409);
  avanca(11);
  const s0 = (await call('/v2/saldo', { token: motorista })).d.disponivel;
  assert.equal((await call(`/v2/corridas/${enc.d.id}/entregue`, { metodo: 'POST', token: motorista })).d.status, 'entregue');
  assert.ok((await call('/v2/saldo', { token: motorista })).d.disponivel > s0);
  assert.match(await ultimoAviso(), /sem confirmação do cliente/);
  await call('/v2/eu/livre', { metodo: 'POST', token: motorista });
  await online(motorista, { lat: farm.lat, lon: farm.lon });

  // borracharia: leva e traz, preço inclui a espera
  const borr = cfg.locais.find((l) => l.categoria === 'borracharia');
  const b1 = await call('/v2/corridas', { metodo: 'POST', token: cli2, corpo: { servico: 'borracharia', coleta: { casa: true }, entrega: { localId: borr.id }, agendado: false } });
  assert.equal(b1.s, 200, JSON.stringify(b1.d));
  assert.equal(b1.d.retorno, true);
  const b2 = await call('/v2/corridas', { metodo: 'POST', token: cli2, corpo: { servico: 'ir', coleta: { casa: true }, entrega: { localId: borr.id }, agendado: false } });
  assert.ok(b1.d.valor > b2.d.valor);
  await call(`/v2/corridas/${b2.d.id}/cancelar`, { metodo: 'POST', token: cli2 });

  // admin cadastra uma distribuidora de gás e ela aparece para os clientes
  const novo = await call('/v2/admin/locais', { metodo: 'POST', token: ADM, corpo: { categoria: 'gas_bebidas', nome: 'Gás do Zé', endereco: 'Rua 28 de Agosto, 900, Centro', lat: -26.4745, lon: -49.006 } });
  assert.equal(novo.s, 200, JSON.stringify(novo.d));
  assert.ok((await call('/v2/config')).d.locais.some((l) => l.nome === 'Gás do Zé'));
  await call(`/v2/admin/locais/${novo.d.id}`, { metodo: 'PUT', token: ADM, corpo: { ativo: false } });
  assert.ok(!(await call('/v2/config')).d.locais.some((l) => l.nome === 'Gás do Zé'));
  assert.equal((await call('/v2/admin/locais', { metodo: 'POST', token: ADM, corpo: { categoria: 'x', nome: 'A', endereco: 'Rua 1, 2', lat: 0, lon: 0 } })).s, 400);
});

test('carro na oficina: vários dias com ida e volta num pagamento só; volta troca coleta e destino', async () => {
  const c3 = await call('/v2/clientes', { metodo: 'POST', corpo: { nome: 'Caio Reis', cpf: '390.533.447-05', endereco: 'Rua Z, 5, Avaí', lat: -26.4690, lon: -48.9800 } });
  const cli3 = c3.d.token;
  const mec = (await call('/v2/config')).d.locais.find((l) => l.categoria === 'mecanico');
  const dias = (await call('/v2/disponibilidade')).d.dias.slice(1, 4);
  const idas = dias.map((d) => d.horarios[0].inicio);
  const voltas = dias.map((d) => d.horarios[d.horarios.length - 1].inicio);
  const trabalho = { nome: 'Trabalho', endereco: 'Rua 28 de Agosto, 2000, Centro', lat: -26.4735, lon: -48.9950 };
  const r = await call('/v2/corridas', { metodo: 'POST', token: cli3, corpo: { servico: 'transporte', coleta: { casa: true }, entrega: trabalho, agendado: true, inicios: idas, voltas } });
  assert.equal(r.s, 200, JSON.stringify(r.d));
  assert.equal(r.d.pacote.viagens, 6);
  assert.equal(r.d.pacote.valor, Math.round(r.d.valor * 6 * 100) / 100);
  assert.equal(linkCriado.order_nsu, r.d.pacote.id);
  assert.equal(linkCriado.items[0].price, Math.round(r.d.pacote.valor * 100));
  await pagar(r.d.pacote.id);
  const minhas = (await call('/v2/corridas', { token: cli3 })).d;
  assert.equal(minhas.filter((c) => c.status === 'buscando').length, 6);
  const volta = minhas.find((c) => c.coleta.nome === 'Trabalho');
  assert.equal(volta.entrega.nome, 'Casa');
  assert.match(await ultimoAviso(), /PACOTE PAGO: 6 viagens/);
  // serviço de oficina também leva até o mecânico
  const m1 = await call('/v2/corridas', { metodo: 'POST', token: cli3, corpo: { servico: 'transporte', coleta: { casa: true }, entrega: { localId: mec.id }, agendado: true, inicio: dias[0].horarios[2].inicio } });
  assert.equal(m1.s, 200, JSON.stringify(m1.d));
  assert.equal(m1.d.pacote, null);
});

test('região: cidades vizinhas, cotação pelo servidor e lojista (aprovação, só serviços de loja)', async () => {
  // Jaraguá do Sul: cliente e pedido aceitos; fora da região, recusado
  const c = await call('/v2/clientes', { metodo: 'POST', corpo: { nome: 'Eva Kroll', cpf: '86253618032', endereco: 'Rua Reinoldo Rau, 660, Centro', lat: -26.4860, lon: -49.0660 } });
  assert.equal(c.s, 200, JSON.stringify(c.d));
  const cli = c.d.token;
  const merc = (await call('/v2/config')).d.locais.find((l) => l.cidade === 'jaragua' && l.categoria === 'mercado');
  const cot = await call('/v2/cotacoes', { metodo: 'POST', token: cli, corpo: { servico: 'comigo', agendado: true, base: { lat: -26.4860, lon: -49.0660 }, pontos: [{ id: merc.id, lat: merc.lat, lon: merc.lon }] } });
  assert.equal(cot.s, 200, JSON.stringify(cot.d));
  assert.ok(cot.d[merc.id].valor > 0);
  const p = await call('/v2/corridas', { metodo: 'POST', token: cli, corpo: { servico: 'comigo', coleta: { localId: merc.id }, entrega: { casa: true }, agendado: true, inicio: (await call('/v2/disponibilidade')).d.dias[2].horarios[1].inicio } });
  assert.equal(p.s, 200, JSON.stringify(p.d));
  assert.equal(p.d.valor, cot.d[merc.id].valor); // o preço mostrado é o cobrado
  await call(`/v2/corridas/${p.d.id}/cancelar`, { metodo: 'POST', token: cli });
  const fora = await call('/v2/corridas', { metodo: 'POST', token: cli, corpo: { servico: 'comigo', coleta: { localId: merc.id }, entrega: { endereco: 'Rua XV, 1, Curitiba', lat: -25.43, lon: -49.27 }, agendado: false } });
  assert.match(fora.d.erro, /fora da região/);
  // Admin desliga Joinville: some da lista e o endereço passa a ser recusado
  await call('/v2/admin/config', { metodo: 'PUT', token: ADM, corpo: { cidadesAtivas: ['guaramirim', 'jaragua', 'schroeder', 'massaranduba'] } });
  assert.ok(!(await call('/v2/config')).d.locais.some((l) => l.cidade === 'joinville'));
  const jv = await call('/v2/corridas', { metodo: 'POST', token: cli, corpo: { servico: 'comigo', coleta: { localId: merc.id }, entrega: { endereco: 'Rua do Príncipe, 100, Centro', lat: -26.3040, lon: -48.8460 }, agendado: false } });
  assert.match(jv.d.erro, /ainda não atendemos Joinville/);
  await call('/v2/admin/config', { metodo: 'PUT', token: ADM, corpo: { cidadesAtivas: ['guaramirim', 'jaragua', 'schroeder', 'massaranduba', 'joinville'] } });
  // rota para o mapa (sem OSRM aqui: estimativa)
  const r = await call('/v2/rota?de=-26.48,-49.06&para=-26.47,-49.00', { token: cli });
  assert.ok(r.d.km > 0 && r.d.caminho.length >= 2);

  // Lojista: cadastra, fica pendente, Admin aprova
  const lj = await call('/v2/lojistas', { metodo: 'POST', corpo: { lojaNome: 'Mercado Bom Preço', cnpj: '12.345.678/0001-95', nome: 'Rui Bom', cpf: '529.982.247-25', telefone: '47 99999-1111', endereco: 'Rua 28 de Agosto, 1500, Centro', lat: -26.4740, lon: -49.0000 } });
  assert.equal(lj.s, 200, JSON.stringify(lj.d));
  assert.match(await ultimoAviso(), /NOVO LOJISTA/);
  const tk = lj.d.token;
  assert.equal((await call('/v2/eu', { token: tk })).d.tipo, 'lojista');
  const pedidoLoja = { servico: 'loja_entrega', coleta: { casa: true }, entrega: { nome: 'Maria', endereco: 'Rua Y, 20, Centro', lat: -26.4790, lon: -48.9900 }, descricao: 'Maria, 47 98888-0000, 3 sacolas', agendado: false };
  assert.match((await call('/v2/corridas', { metodo: 'POST', token: tk, corpo: pedidoLoja })).d.erro, /em análise/);
  const lista = (await call('/v2/admin/lojistas', { token: ADM })).d;
  assert.equal(lista[0].status, 'pendente');
  assert.equal((await call('/v2/admin/resumo', { token: ADM })).d.lojistasPendentes, 1);
  await call(`/v2/admin/lojistas/${lista[0].id}/status`, { metodo: 'POST', token: ADM, corpo: { status: 'aprovado' } });
  assert.equal((await call('/v2/corridas', { metodo: 'POST', token: tk, corpo: { ...pedidoLoja, servico: 'comigo' } })).s, 403); // serviço de cliente
  assert.equal((await call('/v2/corridas', { metodo: 'POST', token: cli, corpo: { ...pedidoLoja, coleta: { localId: merc.id } } })).s, 403); // serviço de loja
  await online(motorista);
  const ok = await call('/v2/corridas', { metodo: 'POST', token: tk, corpo: pedidoLoja });
  assert.equal(ok.s, 200, JSON.stringify(ok.d));
  assert.equal(ok.d.coleta.nome, 'Mercado Bom Preço');
  assert.equal(ok.d.entrega.nome, 'Maria');
  await pagar(ok.d.id);
  const of = (await call('/v2/ofertas', { token: motorista })).d.find((o) => o.id === ok.d.id);
  assert.equal(of.solicitante, 'Mercado Bom Preço (loja)');
  assert.ok(!(await call('/v2/admin/clientes', { token: ADM })).d.some((x) => x.id === lista[0].id));
});

test('preço: deslocamento do motorista até a coleta + coleta até o destino; moto (motoboy) com fator e só nos serviços liberados', async () => {
  const cfg0 = (await call('/v2/config')).d;
  assert.deepEqual([cfg0.motoMinimo, cfg0.motoKmIncluso, cfg0.motoPorKm, cfg0.motoRepassePct, cfg0.comissaoMotoristaPct], [9, 2, 1.8, 95, 80]);
  assert.equal(cfg0.motoAcrescimoPct, 18.75); // APKs antigos: tabela + 18,75%
  assert.equal(cfg0.deslocamentoPadraoKm, 3);
  const c = await call('/v2/clientes', { metodo: 'POST', corpo: { nome: 'Gil Prado', cpf: '123.456.789-09', endereco: 'Rua K, 9, Centro', lat: -26.4790, lon: -48.9900 } });
  const cli = c.d.token;
  const cooper = { lat: -26.471870, lon: -48.976217 };
  const base = { servico: 'comigo', agendado: true, base: cooper, baseEh: 'coleta', pontos: [{ id: 'd', lat: -26.4790, lon: -48.9900 }] };
  // agendado: deslocamento padrão (3 km); com padrão maior, o preço sobe
  const p3 = (await call('/v2/cotacoes', { metodo: 'POST', token: cli, corpo: base })).d.d;
  assert.ok(p3.km > 3);
  await call('/v2/admin/config', { metodo: 'PUT', token: ADM, corpo: { deslocamentoPadraoKm: 8 } });
  const p8 = (await call('/v2/cotacoes', { metodo: 'POST', token: cli, corpo: base })).d.d;
  assert.ok(p8.valor > p3.valor && Math.abs(p8.km - p3.km - 5) < 0.01, JSON.stringify([p3, p8]));
  await call('/v2/admin/config', { metodo: 'PUT', token: ADM, corpo: { deslocamentoPadraoKm: 3 } });
  // agora: usa o motorista livre mais perto da coleta (o do teste está online na Cooper)
  await call('/v2/eu/livre', { metodo: 'POST', token: motorista });
  await online(motorista, cooper);
  const agora = (await call('/v2/cotacoes', { metodo: 'POST', token: cli, corpo: { ...base, agendado: false } })).d.d;
  assert.ok(agora.km < p3.km, 'motorista já na coleta: deslocamento mínimo');
  // os dois lados dão o mesmo preço (lista de mercados com a casa fixa)
  const inverso = (await call('/v2/cotacoes', { metodo: 'POST', token: cli, corpo: { servico: 'comigo', agendado: true, base: { lat: -26.4790, lon: -48.9900 }, baseEh: 'entrega', pontos: [{ id: 'm', ...cooper }] } })).d.m;
  assert.equal(inverso.valor, p3.valor);

  // moto: tabela própria — R$ 9,00 até 2 km + R$ 1,80 por km excedente, sobre os km totais (até a coleta + viagem)
  const tabela = (km) => Math.round((9 + Math.max(0, km - 2) * 1.8) * 100) / 100;
  assert.deepEqual([2, 3, 5, 8, 10].map(tabela), [9, 10.8, 14.4, 19.8, 23.4]);
  // o motoboy recebe 95% da tabela; ele fica com 80% do que o cliente paga → cliente paga tabela × 95/80 (+18,75%)
  const cliente = (km) => Math.round(tabela(km) * (95 / 80) * 100) / 100;
  assert.deepEqual([2, 5, 8, 10].map(cliente), [10.69, 17.1, 23.51, 27.79]);
  assert.deepEqual([2, 3, 5, 8, 10].map((km) => Math.round(cliente(km) * 80) / 100), [8.55, 10.26, 13.68, 18.81, 22.23]); // = 95% da tabela
  const moto = (await call('/v2/cotacoes', { metodo: 'POST', token: cli, corpo: { ...base, servico: 'buscar', veiculo: 'moto' } })).d.d;
  assert.equal(moto.valor, cliente(moto.km), JSON.stringify(moto)); // agendado: sem urgência
  assert.ok(moto.km >= 3); // inclui o deslocamento padrão até a coleta
  const motoAgora = (await call('/v2/cotacoes', { metodo: 'POST', token: cli, corpo: { ...base, agendado: false, servico: 'buscar', veiculo: 'moto' } })).d.d;
  assert.equal(motoAgora.valor, Math.round(cliente(motoAgora.km) * 1.1 * 100) / 100); // agora: + urgência (10%)
  await call('/v2/admin/config', { metodo: 'PUT', token: ADM, corpo: { motoMinimo: 10, motoPorKm: 2 } });
  const nova = (await call('/v2/cotacoes', { metodo: 'POST', token: cli, corpo: { ...base, servico: 'buscar', veiculo: 'moto' } })).d.d;
  assert.equal(nova.valor, Math.round(Math.round((10 + Math.max(0, nova.km - 2) * 2) * 100) / 100 * (95 / 80) * 100) / 100);
  await call('/v2/admin/config', { metodo: 'PUT', token: ADM, corpo: { motoMinimo: 9, motoPorKm: 1.8 } });
  const naoPode = await call('/v2/corridas', { metodo: 'POST', token: cli, corpo: { servico: 'comigo', veiculo: 'moto', coleta: { localId: 'cooper' }, agendado: false } });
  assert.match(naoPode.d.erro, /moto/);
  // motoboy se cadastra; corrida de moto só aparece para moto
  const mb = await call('/v2/motoristas', { metodo: 'POST', corpo: { nome: 'Leo Moto', cpf: '987.654.321-00', telefone: '47977776666', carro: 'Honda CG 160', placa: 'MOT1A23', veiculo: 'moto' } });
  assert.equal(mb.s, 200, JSON.stringify(mb.d));
  assert.match(await ultimoAviso(), /MOTOBOY/);
  const mot2 = mb.d.token;
  assert.equal((await call('/v2/eu', { token: mot2 })).d.veiculo, 'moto');
  const lista = (await call('/v2/admin/motoristas', { token: ADM })).d;
  await call(`/v2/admin/motoristas/${lista.find((m) => m.nome === 'Leo Moto').id}/status`, { metodo: 'POST', token: ADM, corpo: { status: 'aprovado' } });
  await call('/v2/arquivos?tipo=selfie', { metodo: 'POST', token: mot2, bruto: JPG, tipo: 'image/jpeg' });
  await call('/v2/arquivos?tipo=cnh', { metodo: 'POST', token: mot2, bruto: JPG, tipo: 'image/jpeg' });
  await online(mot2, cooper);
  const pm = await call('/v2/corridas', { metodo: 'POST', token: cli, corpo: { servico: 'buscar', veiculo: 'moto', coleta: { localId: 'cooper' }, descricao: 'Pedido 7', agendado: false } });
  assert.equal(pm.s, 200, JSON.stringify(pm.d));
  assert.equal(pm.d.veiculo, 'moto');
  await pagar(pm.d.id);
  assert.ok((await call('/v2/ofertas', { token: mot2 })).d.some((o) => o.id === pm.d.id));
  assert.ok(!(await call('/v2/ofertas', { token: motorista })).d.some((o) => o.id === pm.d.id));
  assert.equal((await call(`/v2/ofertas/${pm.d.id}/aceitar`, { metodo: 'POST', token: motorista })).s, 409);
  assert.equal((await call(`/v2/ofertas/${pm.d.id}/aceitar`, { metodo: 'POST', token: mot2 })).d.status, 'aceito');
});

test('login: CPF + senha em outro aparelho (cliente, motorista, lojista por CNPJ), bloqueio por tentativas, criar/trocar senha e senha provisória', async () => {
  const c = await call('/v2/clientes', { metodo: 'POST', corpo: { nome: 'Lia Neves', cpf: '246.813.579-28', senha: 'segredo1', endereco: 'Rua L, 3, Centro', lat: -26.4752, lon: -48.9930 } });
  assert.equal(c.s, 200, JSON.stringify(c.d));
  // recadastro com o mesmo CPF orienta a usar o Login
  assert.match((await call('/v2/clientes', { metodo: 'POST', corpo: { nome: 'Lia Neves', cpf: '24681357928', senha: 'outra12', endereco: 'Rua L, 3', lat: -26.4752, lon: -48.993 } })).d.erro, /Entrar/);
  const ok = await call('/v2/entrar', { metodo: 'POST', corpo: { perfil: 'cliente', documento: '246.813.579-28', senha: 'segredo1' } });
  assert.equal(ok.s, 200, JSON.stringify(ok.d));
  assert.equal(ok.d.token, c.d.token);
  assert.equal(ok.d.endereco, 'Rua L, 3, Centro');
  assert.equal((await call('/v2/eu', { token: ok.d.token })).d.temSenha, true);
  // senha errada: 5 tentativas bloqueiam
  for (let i = 0; i < 5; i++) assert.equal((await call('/v2/entrar', { metodo: 'POST', corpo: { perfil: 'cliente', documento: '24681357928', senha: 'errada' } })).s, 401);
  assert.equal((await call('/v2/entrar', { metodo: 'POST', corpo: { perfil: 'cliente', documento: '24681357928', senha: 'segredo1' } })).s, 429);
  avanca(16);
  assert.equal((await call('/v2/entrar', { metodo: 'POST', corpo: { perfil: 'cliente', documento: '24681357928', senha: 'segredo1' } })).s, 200);
  // o mesmo CPF como cliente não entra como motorista
  assert.equal((await call('/v2/entrar', { metodo: 'POST', corpo: { perfil: 'motorista', documento: '24681357928', senha: 'segredo1' } })).s, 401);

  // conta antiga (sem senha): pede para criar no aparelho ou pedir provisória; cria sem a atual
  const antigo = await call('/v2/clientes', { metodo: 'POST', corpo: { nome: 'Rui Antigo', cpf: '135.792.468-28', endereco: 'Rua M, 4, Centro', lat: -26.4752, lon: -48.9930 } });
  assert.equal(antigo.s, 200, JSON.stringify(antigo.d));
  assert.match((await call('/v2/entrar', { metodo: 'POST', corpo: { perfil: 'cliente', documento: '13579246828', senha: 'qualquer' } })).d.erro, /ainda não tem senha/);
  assert.equal((await call('/v2/eu', { token: antigo.d.token })).d.temSenha, false);
  assert.equal((await call('/v2/eu/senha', { metodo: 'POST', token: antigo.d.token, corpo: { nova: 'nova123' } })).s, 200);
  assert.equal((await call('/v2/eu/senha', { metodo: 'POST', token: antigo.d.token, corpo: { atual: 'errada', nova: 'outra123' } })).s, 401);
  assert.equal((await call('/v2/entrar', { metodo: 'POST', corpo: { perfil: 'cliente', documento: '13579246828', senha: 'nova123' } })).s, 200);

  // motorista: o do começo dos testes não tem senha → Admin gera uma provisória
  const id = (await call('/v2/admin/motoristas', { token: ADM })).d.find((m) => m.nome === 'Smaylei Luiz').id;
  const prov = await call(`/v2/admin/motoristas/${id}/senha`, { metodo: 'POST', token: ADM });
  assert.match(prov.d.senha, /^\d{6}$/);
  const m = await call('/v2/entrar', { metodo: 'POST', corpo: { perfil: 'motorista', documento: '153.509.460-56', senha: prov.d.senha } });
  assert.equal(m.d.token, motorista);

  // lojista entra pelo CNPJ
  const lj = await call('/v2/lojistas', { metodo: 'POST', corpo: { lojaNome: 'Padaria Sol', cnpj: '11.222.333/0001-81', nome: 'Ana Sol', cpf: '13579246828', telefone: '47 99999-2222', senha: 'padaria1', endereco: 'Rua 28 de Agosto, 900, Centro', lat: -26.4745, lon: -49.006 } });
  assert.equal(lj.s, 200, JSON.stringify(lj.d));
  const pelaLoja = await call('/v2/entrar', { metodo: 'POST', corpo: { perfil: 'lojista', documento: '11.222.333/0001-81', senha: 'padaria1' } });
  assert.equal(pelaLoja.d.token, lj.d.token);
  assert.equal(pelaLoja.d.lojaNome, 'Padaria Sol');
  // o mesmo CPF tem conta de cliente com outra senha: cada perfil tem a sua
  assert.equal((await call('/v2/entrar', { metodo: 'POST', corpo: { perfil: 'lojista', documento: '13579246828', senha: 'padaria1' } })).d.token, lj.d.token);
  assert.equal((await call('/v2/entrar', { metodo: 'POST', corpo: { perfil: 'cliente', documento: '13579246828', senha: 'nova123' } })).d.token, antigo.d.token);
});

test('admin exclui contas: cliente sem senha recadastra com o mesmo CPF; histórico fica como "conta excluída"; motorista com saldo não é excluído', async () => {
  const lista = (await call('/v2/admin/clientes', { token: ADM })).d;
  // com corrida em andamento: não exclui
  const ana = lista.find((c) => c.nome === 'Ana Souza');
  assert.match((await call(`/v2/admin/clientes/${ana.id}`, { metodo: 'DELETE', token: ADM })).d.erro, /andamento/);
  // conta antiga sem senha ("Rui Antigo"): excluída e recadastrada com o mesmo CPF, agora com senha
  const rui = lista.find((c) => c.nome === 'Rui Antigo');
  const tokenRui = (await call('/v2/entrar', { metodo: 'POST', corpo: { perfil: 'cliente', documento: '13579246828', senha: 'nova123' } })).d.token;
  assert.equal((await call(`/v2/admin/clientes/${rui.id}`, { metodo: 'DELETE', token: cliente })).s, 404); // só o admin
  const ex = await call(`/v2/admin/clientes/${rui.id}`, { metodo: 'DELETE', token: ADM });
  assert.equal(ex.s, 200, JSON.stringify(ex.d));
  assert.match(await ultimoAviso(), /Conta de cliente excluída: Rui Antigo/);
  assert.equal((await call('/v2/eu', { token: tokenRui })).s, 401); // o token antigo deixa de valer
  const novo = await call('/v2/clientes', { metodo: 'POST', corpo: { nome: 'Rui Antigo', cpf: '135.792.468-28', senha: 'ruisenha', endereco: 'Rua M, 4, Centro', lat: -26.4752, lon: -48.993 } });
  assert.equal(novo.s, 200, JSON.stringify(novo.d));
  assert.equal((await call('/v2/entrar', { metodo: 'POST', corpo: { perfil: 'cliente', documento: '13579246828', senha: 'ruisenha' } })).d.token, novo.d.token);
  // conta com histórico ("Bia Lima"): as corridas continuam no Admin como "conta excluída"
  const bia = lista.find((c) => c.nome === 'Bia Lima');
  assert.equal((await call(`/v2/admin/clientes/${bia.id}`, { metodo: 'DELETE', token: ADM })).s, 200);
  assert.ok((await call('/v2/admin/corridas', { token: ADM })).d.some((c) => c.cliente_nome === '(conta excluída)'));

  // motorista com saldo: precisa pagar antes
  const mots = (await call('/v2/admin/motoristas', { token: ADM })).d;
  const comSaldo = mots.find((m) => m.disponivel > 0);
  assert.ok(comSaldo, 'há motorista com saldo nos testes');
  assert.match((await call(`/v2/admin/motoristas/${comSaldo.id}`, { metodo: 'DELETE', token: ADM })).d.erro, /saldo|corrida|saque/);
  // motorista sem corridas nem saldo: excluído, e pode se cadastrar de novo
  const m = await call('/v2/motoristas', { metodo: 'POST', corpo: { nome: 'Teo Sem', cpf: '246.813.579-28', telefone: '47966665555', carro: 'Gol', placa: 'TEO1A23', senha: 'teo12345' } });
  assert.equal(m.s, 200, JSON.stringify(m.d));
  const idTeo = (await call('/v2/admin/motoristas', { token: ADM })).d.find((x) => x.nome === 'Teo Sem').id;
  assert.equal((await call(`/v2/admin/motoristas/${idTeo}`, { metodo: 'DELETE', token: ADM })).s, 200);
  assert.equal((await call('/v2/motoristas', { metodo: 'POST', corpo: { nome: 'Teo Sem', cpf: '246.813.579-28', telefone: '47966665555', carro: 'Gol', placa: 'TEO1A23', senha: 'teo12345' } })).s, 200);
  // lojista
  const lj = (await call('/v2/admin/lojistas', { token: ADM })).d.find((l) => l.loja_nome === 'Padaria Sol');
  assert.equal((await call(`/v2/admin/lojistas/${lj.id}`, { metodo: 'DELETE', token: ADM })).s, 200);
  assert.ok(!(await call('/v2/admin/lojistas', { token: ADM })).d.some((l) => l.id === lj.id));
});

const gerarCpf = (base) => {
  const d = String(base).padStart(9, '0').split('').map(Number);
  for (const n of [9, 10]) d.push((d.reduce((a, x, i) => a + x * (n + 1 - i), 0) * 10) % 11 % 10);
  return d.join('');
};

test('delivery das lojas: vitrine com mensalidade, pedido pago pela MOVI, loja aceita, motorista entrega, repasse 100% à loja', async () => {
  const LOJA = { lat: -26.4760, lon: -48.9950 };
  const CASA = { lat: -26.4800, lon: -48.9890 };
  // loja aprovada
  const lj = await call('/v2/lojistas', { metodo: 'POST', corpo: { lojaNome: 'Lanches da Praça', nome: 'Caio Praça', cpf: gerarCpf(314159265), telefone: '47 99999-3333', senha: 'lanche123', endereco: 'Praça Central, 10, Centro', ...LOJA } });
  assert.equal(lj.s, 200, JSON.stringify(lj.d));
  const loja = lj.d.token;
  await call(`/v2/admin/lojistas/${lj.d.id}/status`, { metodo: 'POST', token: ADM, corpo: { status: 'aprovado' } });
  // cliente
  const c = await call('/v2/clientes', { metodo: 'POST', corpo: { nome: 'Lia Fome', cpf: gerarCpf(271828182), telefone: '47988880000', endereco: 'Rua das Flores, 50, Centro', ...CASA } });
  const cli = c.d.token;

  // Delivery ainda desligado no Admin
  assert.equal((await call('/v2/lojas', { token: cli })).s, 403);
  const v0 = (await call('/v2/loja', { token: loja })).d;
  assert.equal(v0.liberado, false);
  assert.equal(v0.mensalidade, 15);
  assert.match((await call('/v2/loja/mensalidade', { metodo: 'POST', token: loja })).d.erro, /ainda não foi liberado/);

  // produtos (a loja já pode cadastrar); foto só da própria loja
  const up = await call('/v2/arquivos?tipo=produto', { metodo: 'POST', token: loja, bruto: JPG, tipo: 'image/jpeg' });
  assert.match(up.d.chave, new RegExp(`^cliente/${lj.d.id}/produto-`));
  assert.equal((await call('/v2/arquivos?tipo=produto', { metodo: 'POST', token: cli, bruto: JPG, tipo: 'image/jpeg' })).s, 403);
  assert.match((await call('/v2/loja/produtos', { metodo: 'POST', token: loja, corpo: { nome: 'X', preco: 10, foto: 'motorista/m1/cnh-x.jpg' } })).d.erro, /nome|Foto/);
  assert.match((await call('/v2/loja/produtos', { metodo: 'POST', token: loja, corpo: { nome: 'X-Burguer', preco: 10, foto: 'motorista/m1/cnh-x.jpg' } })).d.erro, /Foto inválida/);
  assert.match((await call('/v2/loja/produtos', { metodo: 'POST', token: loja, corpo: { nome: 'X-Burguer', preco: 0 } })).d.erro, /Preço/);
  const xb = (await call('/v2/loja/produtos', { metodo: 'POST', token: loja, corpo: { nome: 'X-Burguer', descricao: 'Pão, carne 150 g, queijo', preco: 22.5, categoria: 'Lanches', foto: up.d.chave } })).d;
  const refri = (await call('/v2/loja/produtos', { metodo: 'POST', token: loja, corpo: { nome: 'Refrigerante lata', preco: 6, categoria: 'Bebidas' } })).d;
  assert.equal(xb.temFoto, true);
  assert.equal((await call('/v2/loja/produtos', { token: loja })).d.length, 2);

  // Admin libera o Delivery; a vitrine só aparece depois da mensalidade
  const cfg0 = (await call('/v2/config')).d;
  await call('/v2/admin/config', { metodo: 'PUT', token: ADM, corpo: { servicosAtivos: [...cfg0.servicosAtivos, 'delivery'] } });
  assert.equal((await call('/v2/lojas', { token: cli })).d.lojas.length, 0);
  const mens = await call('/v2/loja/mensalidade', { metodo: 'POST', token: loja });
  assert.equal(mens.s, 200, JSON.stringify(mens.d));
  assert.equal(linkCriado.items[0].price, 1500);
  await pagar(mens.d.id);
  assert.match(await ultimoAviso(), /MENSALIDADE DO DELIVERY paga: Lanches da Praça/);
  const v1 = (await call('/v2/loja', { token: loja })).d;
  assert.equal(v1.ativa, true);
  assert.ok(Date.parse(v1.ativaAte) > Date.now() + 29 * 86400000);
  const fechada = (await call('/v2/lojas', { token: cli })).d.lojas;
  assert.equal(fechada.length, 1); // aparece como fechada
  assert.equal(fechada[0].aberta, false);
  assert.match((await call('/v2/pedidos', { metodo: 'POST', token: cli, corpo: { lojaId: lj.d.id, itens: [{ produtoId: xb.id, qtd: 1 }] } })).d.erro, /fechada/);
  assert.equal((await call('/v2/loja', { metodo: 'PUT', token: loja, corpo: { aberta: true, categoria: 'restaurante', pedidoMinimo: 10, descricao: 'Lanches na chapa' } })).s, 200);
  assert.equal((await call('/v2/eu/pix', { metodo: 'PUT', token: loja, corpo: { tipo: 'email', chave: 'pix@lanches.com', senha: 'lanche123' } })).s, 200);
  const lojas = (await call('/v2/lojas', { token: cli })).d;
  assert.equal(lojas.lojas.length, 1);
  assert.equal(lojas.lojas[0].categoria, 'restaurante');
  assert.equal(lojas.lojas[0].produtos, 2);
  const vit = (await call(`/v2/lojas/${lj.d.id}`, { token: cli })).d;
  assert.deepEqual(vit.produtos.map((x) => x.nome).sort(), ['Refrigerante lata', 'X-Burguer']);
  assert.equal((await call(`/v2/produtos/${xb.id}/foto`)).s, 200); // foto pública (sem login)

  // motorista novo, online perto da loja
  const m = await call('/v2/motoristas', { metodo: 'POST', corpo: { nome: 'Dani Entrega', cpf: gerarCpf(161803398), telefone: '47977771111', carro: 'Onix', placa: 'DAN1E23' } });
  const mot = m.d.token;
  await call(`/v2/admin/motoristas/${m.d.id}/status`, { metodo: 'POST', token: ADM, corpo: { status: 'aprovado' } });
  await call('/v2/arquivos?tipo=selfie', { metodo: 'POST', token: mot, bruto: JPG, tipo: 'image/jpeg' });
  await call('/v2/arquivos?tipo=cnh', { metodo: 'POST', token: mot, bruto: JPG, tipo: 'image/jpeg' });
  assert.equal((await online(mot, LOJA)).s, 200);

  // frete sem urgência (o mesmo "buscar" agora custa mais)
  const cot = (await call('/v2/pedidos/cotar', { metodo: 'POST', token: cli, corpo: { lojaId: lj.d.id } })).d;
  assert.ok(cot.frete > 0 && cot.entrega.ok, JSON.stringify(cot));
  const buscar = (await call('/v2/cotacoes', { metodo: 'POST', token: cli, corpo: { servico: 'buscar', agendado: false, base: LOJA, baseEh: 'coleta', pontos: [{ id: 'c', ...CASA }] } })).d.c;
  assert.ok(buscar.valor > cot.frete, JSON.stringify([buscar, cot]));

  // pedido: mínimo da loja, preços do banco, um pagamento com os itens + frete
  assert.match((await call('/v2/pedidos', { metodo: 'POST', token: cli, corpo: { lojaId: lj.d.id, itens: [{ produtoId: refri.id, qtd: 1 }] } })).d.erro, /pedido mínimo/);
  assert.equal((await call('/v2/corridas', { metodo: 'POST', token: cli, corpo: { servico: 'delivery', entrega: { casa: true } } })).s, 400);
  const ped = await call('/v2/pedidos', { metodo: 'POST', token: cli, corpo: { lojaId: lj.d.id, itens: [{ produtoId: xb.id, qtd: 2, preco: 0.01 }, { produtoId: refri.id, qtd: 1 }], observacao: 'Sem cebola' } });
  assert.equal(ped.s, 200, JSON.stringify(ped.d));
  assert.equal(ped.d.subtotal, 51);
  assert.equal(ped.d.total, Math.round((51 + cot.frete) * 100) / 100);
  assert.deepEqual(linkCriado.items.map((i) => [i.quantity, i.price]), [[2, 2250], [1, 600], [1, Math.round(cot.frete * 100)]]);
  assert.equal(ped.d.status, 'pagamento_pendente');
  await pagar(ped.d.id);
  assert.equal((await call(`/v2/pedidos/${ped.d.id}`, { token: cli })).d.status, 'aguardando_loja');
  assert.match(await ultimoAviso(), /PEDIDO PAGO/);

  // a loja vê o pedido (sem endereço nem sobrenome do cliente) e aceita: vira corrida paga procurando motorista
  const naLoja = (await call('/v2/loja/pedidos', { token: loja })).d;
  assert.equal(naLoja[0].status, 'aguardando_loja');
  assert.equal(naLoja[0].cliente.nome, 'Lia');
  assert.equal(naLoja[0].entregaEndereco, null);
  assert.equal(naLoja[0].observacao, 'Sem cebola');
  const ac = (await call(`/v2/loja/pedidos/${ped.d.id}/aceitar`, { metodo: 'POST', token: loja })).d;
  assert.equal(ac.status, 'aceito');
  assert.equal((await call(`/v2/loja/pedidos/${ped.d.id}/aceitar`, { metodo: 'POST', token: loja })).s, 409);
  const of = (await call('/v2/ofertas', { token: mot })).d.find((o) => o.id === ac.corridaId);
  assert.ok(of, 'oferta para o motorista');
  assert.equal(of.servico, 'delivery');
  assert.equal(of.ganho, Math.round(cot.frete * 0.8 * 100) / 100); // delivery sem urgência: 80% do frete
  assert.equal(of.valor, of.ganho); // o motorista não vê o valor pago pelo cliente
  assert.equal(of.incentivo, 0);
  assert.match(of.descricao, /Pedido #\w{4} · 3 itens/);
  assert.equal((await call(`/v2/ofertas/${ac.corridaId}/aceitar`, { metodo: 'POST', token: mot })).s, 200);
  assert.equal((await call(`/v2/corridas/${ac.corridaId}/cancelar`, { metodo: 'POST', token: cli })).s, 409); // cancelar só pelo suporte
  assert.equal((await call(`/v2/loja/pedidos`, { token: loja })).d[0].motorista.placa, 'DAN1E23');
  assert.equal((await call(`/v2/corridas/${ac.corridaId}/cheguei`, { metodo: 'POST', token: mot, corpo: LOJA })).d.status, 'no_local');
  assert.equal((await call(`/v2/corridas/${ac.corridaId}/coletei`, { metodo: 'POST', token: mot })).d.status, 'em_andamento');
  await call(`/v2/corridas/${ac.corridaId}/cheguei-destino`, { metodo: 'POST', token: mot, corpo: CASA });
  const rec = await call(`/v2/corridas/${ac.corridaId}/confirmar-recebimento`, { metodo: 'POST', token: cli });
  assert.equal(rec.d.status, 'entregue');
  assert.equal((await call(`/v2/pedidos/${ped.d.id}`, { token: cli })).d.status, 'entregue');
  // frete: 80% ao motorista; produtos: 100% à loja
  assert.equal((await call('/v2/saldo', { token: mot })).d.disponivel, Math.round(cot.frete * 0.8 * 100) / 100);
  const sl = (await call('/v2/loja/saldo', { token: loja })).d;
  assert.equal(sl.disponivel, 51);
  assert.equal(sl.chavePix, 'pix@lanches.com');
  const rp = await call('/v2/loja/repasses', { metodo: 'POST', token: loja });
  assert.equal(rp.d.valor, 51);
  assert.match(await ultimoAviso(), /REPASSE DE LOJA SOLICITADO/);
  assert.equal((await call('/v2/loja/repasses', { metodo: 'POST', token: loja })).s, 409);
  const adm = (await call('/v2/admin/delivery', { token: ADM })).d;
  assert.equal(adm.repasses[0].status, 'solicitado');
  assert.equal((await call('/v2/admin/resumo', { token: ADM })).d.repassesLojaPendentesQtd, 1);
  await call(`/v2/admin/repasses-loja/${adm.repasses[0].id}/pagar`, { metodo: 'POST', token: ADM });
  assert.equal((await call('/v2/loja/saldo', { token: loja })).d.disponivel, 0);

  // loja recusa: estorno total, aparece em Estornos e é marcado como feito
  await call('/v2/eu/livre', { metodo: 'POST', token: mot }); // o motorista fica livre de novo
  const r2 = await call('/v2/pedidos', { metodo: 'POST', token: cli, corpo: { lojaId: lj.d.id, itens: [{ produtoId: xb.id, qtd: 1 }] } });
  assert.equal(r2.s, 200, JSON.stringify(r2.d));
  const p2 = r2.d;
  await pagar(p2.id);
  await call(`/v2/loja/pedidos/${p2.id}/recusar`, { metodo: 'POST', token: loja, corpo: { motivo: 'Acabou o pão' } });
  const p2c = (await call(`/v2/pedidos/${p2.id}`, { token: cli })).d;
  assert.equal(p2c.status, 'cancelado');
  assert.equal(p2c.reembolso, p2.total);
  assert.match(p2c.motivo, /Acabou o pão/);
  const est = (await call('/v2/admin/estornos', { token: ADM })).d.find((e) => e.id === p2.id);
  assert.ok(est && est.reembolso === p2.total);
  await call(`/v2/admin/estornos/${p2.id}/feito`, { metodo: 'POST', token: ADM });
  assert.ok((await call(`/v2/pedidos/${p2.id}`, { token: cli })).d.reembolsadoEm);

  // loja não responde no prazo: cancelado com estorno
  const r3 = await call('/v2/pedidos', { metodo: 'POST', token: cli, corpo: { lojaId: lj.d.id, itens: [{ produtoId: xb.id, qtd: 1 }] } });
  assert.equal(r3.s, 200, JSON.stringify(r3.d));
  const p3 = r3.d;
  await pagar(p3.id);
  db.prepare(`UPDATE pedidos SET pago_em=? WHERE id=?`).run(new Date(Date.now() - 11 * 60000).toISOString(), p3.id);
  const p3c = (await call(`/v2/pedidos/${p3.id}`, { token: cli })).d;
  assert.equal(p3c.status, 'cancelado');
  assert.equal(p3c.reembolso, p3.total);
  assert.match(await ultimoAviso(), /LOJA NÃO RESPONDEU/);

  // pedido em aberto impede excluir a loja; o Admin cancela o pedido (estorno) e dá dias de cortesia
  const r4 = await call('/v2/pedidos', { metodo: 'POST', token: cli, corpo: { lojaId: lj.d.id, itens: [{ produtoId: xb.id, qtd: 1 }] } });
  assert.equal(r4.s, 200, JSON.stringify(r4.d));
  const p4 = r4.d;
  await pagar(p4.id);
  assert.match((await call(`/v2/admin/lojistas/${lj.d.id}`, { metodo: 'DELETE', token: ADM })).d.erro, /delivery/);
  assert.equal((await call(`/v2/admin/pedidos/${p4.id}/cancelar`, { metodo: 'POST', token: ADM })).s, 200);
  assert.equal((await call(`/v2/pedidos/${p4.id}`, { token: cli })).d.reembolso, p4.total);
  const antes = Date.parse((await call('/v2/loja', { token: loja })).d.ativaAte);
  await call(`/v2/admin/lojistas/${lj.d.id}/delivery-dias`, { metodo: 'POST', token: ADM, corpo: { dias: 30 } });
  assert.ok(Date.parse((await call('/v2/loja', { token: loja })).d.ativaAte) >= antes + 29 * 86400000);
  // produto desativado some da vitrine
  await call(`/v2/loja/produtos/${refri.id}`, { metodo: 'PUT', token: loja, corpo: { ativo: false } });
  assert.equal((await call(`/v2/lojas/${lj.d.id}`, { token: cli })).d.produtos.length, 1);
});

test('urgência (pedido agora): o cliente paga, o motorista recebe 80% sem a urgência + incentivo do Admin; o resto fica com a MOVI', async () => {
  const cfg0 = (await call('/v2/config')).d;
  await call('/v2/admin/config', { metodo: 'PUT', token: ADM, corpo: { urgencia: { tipo: 'reais', valor: 10 } } });
  const c = await call('/v2/clientes', { metodo: 'POST', corpo: { nome: 'Tom Urgente', cpf: gerarCpf(141421356), endereco: 'Rua Z, 7, Centro', lat: -26.4790, lon: -48.9900 } });
  const cli = c.d.token;
  const m = await call('/v2/motoristas', { metodo: 'POST', corpo: { nome: 'Uli Rápido', cpf: gerarCpf(173205080), telefone: '47977772222', carro: 'HB20', placa: 'ULI2B34' } });
  const mot = m.d.token;
  await call(`/v2/admin/motoristas/${m.d.id}/status`, { metodo: 'POST', token: ADM, corpo: { status: 'aprovado' } });
  await call('/v2/arquivos?tipo=selfie', { metodo: 'POST', token: mot, bruto: JPG, tipo: 'image/jpeg' });
  await call('/v2/arquivos?tipo=cnh', { metodo: 'POST', token: mot, bruto: JPG, tipo: 'image/jpeg' });
  await online(mot, COOPER);
  const p = await call('/v2/corridas', { metodo: 'POST', token: cli, corpo: { servico: 'comigo', coleta: { localId: 'cooper' }, agendado: false } });
  assert.equal(p.s, 200, JSON.stringify(p.d));
  await pagar(p.d.id);
  const adm = (await call('/v2/admin/corridas', { token: ADM })).d.find((x) => x.id === p.d.id);
  assert.equal(adm.urgencia, 10); // o Admin vê a taxa de urgência
  const of = (await call('/v2/ofertas', { token: mot })).d.find((o) => o.id === p.d.id);
  const esperado = Math.round((((p.d.valor - 10) * 80) / 100 + 4) * 100) / 100;
  assert.equal(of.ganho, esperado); // 80% do frete sem a urgência + R$ 4
  assert.equal(of.valor, esperado); // nunca o valor pago pelo cliente
  assert.equal(of.incentivo, 4);
  // o Admin muda o incentivo para R$ 3
  await call('/v2/admin/config', { metodo: 'PUT', token: ADM, corpo: { incentivoUrgencia: 3 } });
  assert.equal((await call('/v2/ofertas', { token: mot })).d.find((o) => o.id === p.d.id).ganho, Math.round((esperado - 1) * 100) / 100);
  assert.match((await call('/v2/admin/config', { metodo: 'PUT', token: ADM, corpo: { incentivoUrgencia: -1 } })).d.erro, /Incentivo/);
  await call(`/v2/corridas/${p.d.id}/cancelar`, { metodo: 'POST', token: cli });
  await call('/v2/admin/config', { metodo: 'PUT', token: ADM, corpo: { urgencia: cfg0.urgencia, incentivoUrgencia: 4 } });
});


test('Pagar.me: conta de recebimento (motorista e loja), corrida agora paga no aceite com split, cartão, estorno automático e delivery com a loja recebendo direto', async () => {
  // Admin liga a Pagar.me (exige a chave pública e o segredo no Worker)
  assert.match((await call('/v2/admin/config', { metodo: 'PUT', token: ADM, corpo: { gateway: 'pagarme' } })).d.erro, /chave pública/);
  assert.equal((await call('/v2/admin/config', { metodo: 'PUT', token: ADM, corpo: { gateway: 'pagarme', pagarmeChavePublica: 'pk_test_abc', pagarmeRecebedorMovi: 'rp_movi', urgencia: { tipo: 'reais', valor: 10 }, taxaPixPct: 0, taxaCartaoPct: 0 } })).s, 200); // taxas por cima: teste próprio abaixo
  const cfgApp = (await call('/v2/config')).d;
  assert.equal(cfgApp.gateway, 'pagarme');
  assert.equal(cfgApp.pagarmeChavePublica, 'pk_test_abc');
  const pag = (await call('/v2/admin/pagamentos', { token: ADM })).d;
  assert.equal(pag.ambiente, 'teste');
  assert.match(pag.webhook, /\/webhook\/pagarme$/);

  // motorista com conta de recebimento (prova de vida pela Pagar.me)
  const cpfMot = gerarCpf(223606797);
  const m = await call('/v2/motoristas', { metodo: 'POST', corpo: { nome: 'Pedro Split', cpf: cpfMot, telefone: '47966661111', carro: 'Onix', placa: 'PED1S23' } });
  const mot = m.d.token;
  await call(`/v2/admin/motoristas/${m.d.id}/status`, { metodo: 'POST', token: ADM, corpo: { status: 'aprovado' } });
  await call('/v2/arquivos?tipo=selfie', { metodo: 'POST', token: mot, bruto: JPG, tipo: 'image/jpeg' });
  await call('/v2/arquivos?tipo=cnh', { metodo: 'POST', token: mot, bruto: JPG, tipo: 'image/jpeg' });
  assert.equal((await call('/v2/eu/recebedor', { token: mot })).d.temConta, false);
  assert.match((await call('/v2/eu/recebedor', { metodo: 'POST', token: mot, corpo: { email: 'x' } })).d.erro, /e-mail/);
  const dadosConta = {
    email: 'pedro@exemplo.com', nascimento: '1990-05-20', rendaMensal: 3000, profissao: 'Motorista de aplicativo',
    endereco: { rua: 'Rua das Flores', numero: '50', bairro: 'Centro', cidade: 'Guaramirim', uf: 'SC', cep: '89270-000' },
    conta: { banco: '260', agencia: '0001', conta: '123456', contaDv: '7', tipo: 'checking' },
  };
  const rc = await call('/v2/eu/recebedor', { metodo: 'POST', token: mot, corpo: dadosConta });
  assert.equal(rc.s, 200, JSON.stringify(rc.d));
  assert.equal(rc.d.status, 'registration');
  assert.equal(rc.d.kycUrl, 'https://pagar.me/kyc/abc123');
  const enviado = [...pg.recebedores.values()].at(-1).corpo;
  assert.equal(enviado.register_information.type, 'individual');
  assert.equal(enviado.register_information.document, cpfMot);
  assert.equal(enviado.default_bank_account.holder_document, cpfMot); // conta do próprio motorista
  pg.recebedores.get(rc.d.status === 'registration' ? [...pg.recebedores.keys()].at(-1) : '').status = 'active'; // KYC aprovado
  assert.equal((await call('/v2/eu/recebedor', { token: mot })).d.ativo, true);

  // corrida para agora: o cliente pede sem pagar; paga quando o motorista aceita
  const c = await call('/v2/clientes', { metodo: 'POST', corpo: { nome: 'Rita Pix', cpf: gerarCpf(244948974), telefone: '47911112222', endereco: 'Rua Q, 3, Centro', lat: -26.4790, lon: -48.9900 } });
  const cli = c.d.token;
  await online(mot, COOPER);
  const p1 = await call('/v2/corridas', { metodo: 'POST', token: cli, corpo: { servico: 'comigo', coleta: { localId: 'cooper' }, agendado: false } });
  assert.equal(p1.s, 200, JSON.stringify(p1.d));
  assert.equal(p1.d.status, 'buscando');
  assert.equal(p1.d.pagarAoAceitar, true);
  assert.equal(p1.d.checkoutUrl, null);
  assert.match((await call('/v2/pagar', { metodo: 'POST', token: cli, corpo: { tipo: 'corrida', id: p1.d.id, metodo: 'pix' } })).d.erro, /Aguarde um motorista/);
  const of = (await call('/v2/ofertas', { token: mot })).d.find((o) => o.id === p1.d.id);
  assert.ok(of, 'oferta antes do pagamento');
  assert.equal((await call(`/v2/ofertas/${p1.d.id}/aceitar`, { metodo: 'POST', token: mot })).d.aguardandoPagamento, true);
  assert.match((await call(`/v2/corridas/${p1.d.id}/cheguei`, { metodo: 'POST', token: mot, corpo: COOPER })).d.erro, /Aguarde o cliente pagar/);
  assert.equal((await call(`/v2/corridas/${p1.d.id}`, { token: cli })).d.aguardandoPagamento, true);
  // Pix com split: ganho direto ao motorista, resto para a MOVI (que paga as taxas)
  const pix = (await call('/v2/pagar', { metodo: 'POST', token: cli, corpo: { tipo: 'corrida', id: p1.d.id, metodo: 'pix' } })).d;
  assert.equal(pix.status, 'pendente');
  assert.equal(pix.qrCode, '00020126PIXMOVI');
  const ganho = await ganhoEsperado(p1.d.id);
  const split = pg.ultimo.payments[0].split;
  assert.deepEqual(split.map((x) => [x.recipient_id, x.amount, x.options.charge_processing_fee]), [[[...pg.recebedores.keys()].at(-1), Math.round(ganho * 100), false], ['rp_movi', Math.round(p1.d.valor * 100) - Math.round(ganho * 100), true]]);
  assert.equal(pg.ultimo.customer.document, gerarCpf(244948974));
  assert.equal((await call('/v2/pagar', { metodo: 'POST', token: cli, corpo: { tipo: 'corrida', id: p1.d.id, metodo: 'pix' } })).d.id, pix.id); // mesmo QR
  assert.equal((await call(`/v2/cobrancas/${pix.id}`, { token: mot })).s, 404); // só quem paga consulta a cobrança
  const outro = (await call('/v2/clientes', { metodo: 'POST', corpo: { nome: 'Ugo Outro', cpf: gerarCpf(282842712), endereco: 'Rua R, 1, Centro', lat: -26.479, lon: -48.99 } })).d.token;
  assert.equal((await call(`/v2/cobrancas/${pix.id}`, { token: outro })).s, 404);
  pg.pedidos.get(`or_${pg.n}`).status = 'paid'; // cliente pagou no banco
  assert.equal((await call(`/v2/cobrancas/${pix.id}`, { token: cli })).d.status, 'paga');
  const pago = (await call(`/v2/corridas/${p1.d.id}`, { token: cli })).d;
  assert.ok(pago.pagoEm && !pago.aguardandoPagamento);
  assert.match(await ultimoAviso(), /PAGO NO ACEITE.*direto na conta do motorista/);
  assert.equal((await call(`/v2/corridas/${p1.d.id}/cheguei`, { metodo: 'POST', token: mot, corpo: COOPER })).d.status, 'no_local');
  await call(`/v2/corridas/${p1.d.id}/confirmar-motorista`, { metodo: 'POST', token: cli });
  const s1 = (await call('/v2/saldo', { token: mot })).d;
  assert.equal(s1.disponivel, 0); // nada a sacar: o ganho já foi para a conta Pagar.me dele
  assert.equal(s1.recebidoDireto, ganho);
  await call(`/v2/corridas/${p1.d.id}/entregue`, { metodo: 'POST', token: mot });

  // cartão pago na hora; cliente cancela antes da chegada → estorno automático pela API
  const p2 = (await call('/v2/corridas', { metodo: 'POST', token: cli, corpo: { servico: 'comigo', coleta: { localId: 'cooper' }, agendado: false } })).d;
  await call(`/v2/ofertas/${p2.id}/aceitar`, { metodo: 'POST', token: mot });
  assert.match((await call('/v2/pagar', { metodo: 'POST', token: cli, corpo: { tipo: 'corrida', id: p2.id, metodo: 'cartao', cardToken: 'tok_ok' } })).d.erro, /CEP/);
  const recus = (await call('/v2/pagar', { metodo: 'POST', token: cli, corpo: { tipo: 'corrida', id: p2.id, metodo: 'cartao', cardToken: 'tok_recusado', cep: '89270000' } })).d;
  assert.equal(recus.status, 'falhou');
  assert.match(recus.erro, /não autorizada/);
  const cart = (await call('/v2/pagar', { metodo: 'POST', token: cli, corpo: { tipo: 'corrida', id: p2.id, metodo: 'cartao', cardToken: 'tok_ok', cep: '89270-000' } })).d;
  assert.equal(cart.status, 'paga');
  assert.equal(pg.ultimo.payments[0].credit_card.installments, 1); // só à vista
  assert.equal(pg.ultimo.payments[0].credit_card.card.billing_address.zip_code, '89270000');
  await call(`/v2/corridas/${p2.id}/cancelar`, { metodo: 'POST', token: cli });
  await call('/v2/disponibilidade'); // próxima requisição processa o estorno
  assert.deepEqual(pg.estornos.at(-1), { charge: `ch_${pg.n}`, amount: Math.round(p2.valor * 100) });
  assert.ok((await call(`/v2/corridas/${p2.id}`, { token: cli })).d.reembolsadoEm);
  assert.match(await ultimoAviso(), /ESTORNO AUTOMÁTICO/);

  // aceitou e o cliente não pagou no prazo: cai e o motorista fica livre
  const p3 = (await call('/v2/corridas', { metodo: 'POST', token: cli, corpo: { servico: 'comigo', coleta: { localId: 'cooper' }, agendado: false } })).d;
  await call(`/v2/ofertas/${p3.id}/aceitar`, { metodo: 'POST', token: mot });
  db.prepare(`UPDATE corridas SET pagamento_ate=? WHERE id=?`).run(new Date(Date.now() - 1000).toISOString(), p3.id);
  const p3c = (await call(`/v2/corridas/${p3.id}`, { token: cli })).d;
  assert.equal(p3c.status, 'cancelado');
  assert.equal(p3c.motivo, 'nao_pago');
  assert.match(await ultimoAviso(), /NÃO PAGOU depois do aceite/);

  // delivery: loja com conta de recebimento → produtos direto para a loja; mensalidade pela Pagar.me
  const lj = await call('/v2/lojistas', { metodo: 'POST', corpo: { lojaNome: 'Açaí da Vila', nome: 'Vera Vila', cpf: gerarCpf(264575131), telefone: '47 98888-4444', senha: 'acai1234', endereco: 'Rua Vila, 5, Centro', lat: -26.4770, lon: -48.9930 } });
  const loja = lj.d.token;
  await call(`/v2/admin/lojistas/${lj.d.id}/status`, { metodo: 'POST', token: ADM, corpo: { status: 'aprovado' } });
  const rl = await call('/v2/loja/recebedor', { metodo: 'POST', token: loja, corpo: { ...dadosConta, email: 'vera@exemplo.com' } });
  assert.equal(rl.s, 200, JSON.stringify(rl.d));
  const rpLoja = [...pg.recebedores.keys()].at(-1);
  pg.recebedores.get(rpLoja).status = 'active';
  assert.equal((await call('/v2/admin/recebedores/atualizar', { metodo: 'POST', token: ADM })).d.atualizados >= 1, true);
  const mens = (await call('/v2/loja/mensalidade', { metodo: 'POST', token: loja })).d;
  assert.equal(mens.checkoutUrl, null);
  const pm = (await call('/v2/pagar', { metodo: 'POST', token: loja, corpo: { tipo: 'mensalidade', id: mens.id, metodo: 'cartao', cardToken: 'tok_ok', cep: '89270000' } })).d;
  assert.equal(pm.status, 'paga');
  assert.equal(pg.ultimo.payments[0].split, undefined); // mensalidade é da MOVI
  assert.equal((await call('/v2/loja', { token: loja })).d.ativa, true);
  const acai = (await call('/v2/loja/produtos', { metodo: 'POST', token: loja, corpo: { nome: 'Açaí 500 ml', preco: 18 } })).d;
  await call('/v2/loja', { metodo: 'PUT', token: loja, corpo: { aberta: true } });
  await call('/v2/eu/livre', { metodo: 'POST', token: mot });
  const ped = (await call('/v2/pedidos', { metodo: 'POST', token: cli, corpo: { lojaId: lj.d.id, itens: [{ produtoId: acai.id, qtd: 2 }] } })).d;
  assert.equal(ped.status, 'pagamento_pendente');
  assert.equal(ped.checkoutUrl, null);
  const pp = (await call('/v2/pagar', { metodo: 'POST', token: cli, corpo: { tipo: 'pedido', id: ped.id, metodo: 'pix' } })).d;
  const sp = pg.ultimo.payments[0].split;
  assert.deepEqual(sp.map((x) => [x.recipient_id, x.amount]), [[rpLoja, 3600], ['rp_movi', Math.round(ped.frete * 100)]]);
  assert.equal(pg.ultimo.items.length, 2);
  // confirmação pelo webhook (o status é conferido na API)
  pg.pedidos.get(`or_${pg.n}`).status = 'paid';
  assert.equal((await call('/webhook/pagarme', { metodo: 'POST', corpo: { type: 'order.paid', data: { id: `or_${pg.n}` } } })).s, 200);
  assert.equal((await call(`/v2/pedidos/${ped.id}`, { token: cli })).d.status, 'aguardando_loja');
  assert.equal((await call(`/v2/cobrancas/${pp.id}`, { token: cli })).d.status, 'paga');
  const aceito = (await call(`/v2/loja/pedidos/${ped.id}/aceitar`, { metodo: 'POST', token: loja })).d;
  await call(`/v2/ofertas/${aceito.corridaId}/aceitar`, { metodo: 'POST', token: mot });
  await call(`/v2/corridas/${aceito.corridaId}/cheguei`, { metodo: 'POST', token: mot, corpo: { lat: -26.4770, lon: -48.9930 } });
  await call(`/v2/corridas/${aceito.corridaId}/coletei`, { metodo: 'POST', token: mot });
  await call(`/v2/corridas/${aceito.corridaId}/cheguei-destino`, { metodo: 'POST', token: mot, corpo: { lat: -26.4790, lon: -48.9900 } });
  await call(`/v2/corridas/${aceito.corridaId}/confirmar-recebimento`, { metodo: 'POST', token: cli });
  const sl = (await call('/v2/loja/saldo', { token: loja })).d;
  assert.equal(sl.disponivel, 0); // nada para a MOVI repassar
  assert.equal(sl.recebidoDireto, 36);

  // webhook falso não confirma nada (sem pedido correspondente)
  assert.equal((await call('/webhook/pagarme', { metodo: 'POST', corpo: { type: 'order.paid', data: { id: 'or_inexistente' } } })).s, 200);
  await call('/v2/admin/config', { metodo: 'PUT', token: ADM, corpo: { gateway: 'infinitepay' } });
  assert.equal((await call('/v2/config')).d.gateway, 'infinitepay');
});

test('taxas por cima (Pagar.me): cliente paga valor + taxa do Pix/cartão; motorista, loja e MOVI recebem o valor mostrado; estorno devolve a taxa. Chave Pix escolhida com senha', async () => {
  const PIX = 0.99, CARTAO = 4.19, FIXO_CARTAO = 0.5;
  const r = await call('/v2/admin/config', { metodo: 'PUT', token: ADM, corpo: { gateway: 'pagarme', taxaPixPct: PIX, taxaPixFixo: 0, taxaCartaoPct: CARTAO, taxaCartaoFixo: FIXO_CARTAO } });
  assert.equal(r.s, 200, JSON.stringify(r.d));
  assert.match((await call('/v2/admin/config', { metodo: 'PUT', token: ADM, corpo: { taxaPixPct: 30 } })).d.erro, /0 a 20%/);
  // O cliente vê um preço só: a maior taxa entre os meios ligados, embutida (sem mostrar "taxa").
  assert.deepEqual((await call('/v2/config')).d.taxaPreco, { pct: CARTAO, fixo: FIXO_CARTAO });
  assert.equal((await call('/v2/config')).d.taxasPagamento, undefined);
  // O que a Pagar.me desconta (arredondando a taxa para cima) da parte da MOVI, que é a principal do split.
  const taxaPg = (totalCent, pct, fixoCent) => Math.ceil((totalCent * pct) / 100) + fixoCent;
  const soma = (itens) => itens.reduce((sm, i) => sm + i.amount * i.quantity, 0);

  // motorista com conta ativa
  const m = await call('/v2/motoristas', { metodo: 'POST', corpo: { nome: 'Tito Taxa', cpf: gerarCpf(311122233), telefone: '47966662222', carro: 'HB20', placa: 'TIT1A23' } });
  const mot = m.d.token;
  await call(`/v2/admin/motoristas/${m.d.id}/status`, { metodo: 'POST', token: ADM, corpo: { status: 'aprovado' } });
  await call('/v2/arquivos?tipo=selfie', { metodo: 'POST', token: mot, bruto: JPG, tipo: 'image/jpeg' });
  await call('/v2/arquivos?tipo=cnh', { metodo: 'POST', token: mot, bruto: JPG, tipo: 'image/jpeg' });
  const conta = {
    email: 'tito@exemplo.com', nascimento: '1988-03-10', rendaMensal: 3000, profissao: 'Motorista de aplicativo',
    endereco: { rua: 'Rua A', numero: '1', bairro: 'Centro', cidade: 'Guaramirim', uf: 'SC', cep: '89270-000' },
    conta: { banco: '260', agencia: '0001', conta: '654321', contaDv: '0', tipo: 'checking' },
  };
  assert.equal((await call('/v2/eu/recebedor', { metodo: 'POST', token: mot, corpo: conta })).s, 200);
  const rpMot = [...pg.recebedores.keys()].at(-1);
  pg.recebedores.get(rpMot).status = 'active';
  assert.equal((await call('/v2/eu/recebedor', { token: mot })).d.ativo, true);
  const cli = (await call('/v2/clientes', { metodo: 'POST', corpo: { nome: 'Lia Taxa', cpf: gerarCpf(322233344), telefone: '47911113333', endereco: 'Rua T, 3, Centro', lat: -26.479, lon: -48.99 } })).d.token;
  await call('/v2/eu/livre', { metodo: 'POST', token: mot });
  await online(mot, COOPER);

  // Pix: total = valor + taxa; o motorista recebe o ganho cheio e a MOVI, depois da taxa, a parte dela
  const c1 = (await call('/v2/corridas', { metodo: 'POST', token: cli, corpo: { servico: 'comigo', coleta: { localId: 'cooper' }, agendado: false } })).d;
  await call(`/v2/ofertas/${c1.id}/aceitar`, { metodo: 'POST', token: mot });
  const pix = (await call('/v2/pagar', { metodo: 'POST', token: cli, corpo: { tipo: 'corrida', id: c1.id, metodo: 'pix' } })).d;
  const vc = Math.round(c1.valor * 100);
  const totalCent = Math.round(pix.valor * 100);
  assert.equal(pix.liquido, c1.valor);
  assert.ok(pix.taxa > 0 && totalCent === vc + Math.round(pix.taxa * 100));
  assert.equal(totalCent, Math.ceil(((vc + 50) / (1 - CARTAO / 100)) - 1e-6)); // mesmo preço em qualquer meio
  assert.equal(soma(pg.ultimo.items), totalCent);
  assert.equal(pg.ultimo.items.length, 1); // sem item "taxa": vai embutida no próprio serviço
  assert.equal(pg.ultimo.items[0].amount, totalCent);
  const ganho = await ganhoEsperado(c1.id);
  const sp = pg.ultimo.payments[0].split;
  assert.equal(sp[0].recipient_id, rpMot);
  assert.equal(sp[0].amount, Math.round(ganho * 100)); // motorista: exatamente o ganho mostrado
  assert.equal(sp[0].amount + sp[1].amount, totalCent);
  assert.ok(sp[1].amount - taxaPg(totalCent, PIX, 0) >= vc - Math.round(ganho * 100)); // MOVI: a parte dela inteira
  pg.pedidos.get(`or_${pg.n}`).status = 'paid';
  assert.equal((await call(`/v2/cobrancas/${pix.id}`, { token: cli })).d.status, 'paga');
  const pago = (await call(`/v2/corridas/${c1.id}`, { token: cli })).d;
  assert.equal(pago.taxaPagamento, pix.taxa);
  assert.match(await ultimoAviso(), /PAGO NO ACEITE .* \+ taxa R\$/);
  // cliente cancela antes da chegada: estorno de tudo o que pagou (com a taxa)
  await call(`/v2/corridas/${c1.id}/cancelar`, { metodo: 'POST', token: cli });
  await call('/v2/disponibilidade');
  assert.deepEqual(pg.estornos.at(-1), { charge: `ch_${pg.n}`, amount: totalCent });

  // cartão com taxa fixa
  await call('/v2/eu/livre', { metodo: 'POST', token: mot });
  const c2 = (await call('/v2/corridas', { metodo: 'POST', token: cli, corpo: { servico: 'comigo', coleta: { localId: 'cooper' }, agendado: false } })).d;
  await call(`/v2/ofertas/${c2.id}/aceitar`, { metodo: 'POST', token: mot });
  const cart = (await call('/v2/pagar', { metodo: 'POST', token: cli, corpo: { tipo: 'corrida', id: c2.id, metodo: 'cartao', cardToken: 'tok_ok', cep: '89270000' } })).d;
  assert.equal(cart.status, 'paga');
  const t2 = Math.round(cart.valor * 100), v2 = Math.round(c2.valor * 100);
  assert.equal(t2, Math.ceil(((v2 + 50) / (1 - CARTAO / 100)) - 1e-6));
  assert.ok(t2 - taxaPg(t2, CARTAO, 50) >= v2 && t2 - taxaPg(t2, CARTAO, 50) <= v2 + 1);
  const g2 = Math.round((await ganhoEsperado(c2.id)) * 100);
  assert.equal(pg.ultimo.payments[0].split[0].amount, g2);
  assert.ok(pg.ultimo.payments[0].split[1].amount - taxaPg(t2, CARTAO, 50) >= v2 - g2);
  // motorista já no local e o cliente cancela: taxa de deslocamento fica, o resto (com a taxa do cartão) volta
  await call(`/v2/corridas/${c2.id}/cheguei`, { metodo: 'POST', token: mot, corpo: COOPER });
  await call(`/v2/corridas/${c2.id}/cancelar`, { metodo: 'POST', token: cli });
  await call('/v2/disponibilidade');
  assert.equal(pg.estornos.at(-1).amount, t2 - 700); // R$ 7 de deslocamento (configurado num teste anterior)

  // delivery: loja recebe os produtos cheios; MOVI o frete; cliente paga a taxa
  const lj = await call('/v2/lojistas', { metodo: 'POST', corpo: { lojaNome: 'Pão da Praça', nome: 'Rui Praça', cpf: gerarCpf(333344455), telefone: '47 98888-5555', senha: 'pao12345', endereco: 'Rua Praça, 9, Centro', lat: -26.477, lon: -48.993 } });
  const loja = lj.d.token;
  await call(`/v2/admin/lojistas/${lj.d.id}/status`, { metodo: 'POST', token: ADM, corpo: { status: 'aprovado' } });
  assert.deepEqual((await call('/v2/loja', { token: loja })).d.recebedor, { temConta: false, status: null, ativo: false });
  assert.equal((await call('/v2/loja/recebedor', { metodo: 'POST', token: loja, corpo: { ...conta, email: 'rui@exemplo.com' } })).s, 200);
  const rpLoja = [...pg.recebedores.keys()].at(-1);
  pg.recebedores.get(rpLoja).status = 'active';
  await call('/v2/admin/recebedores/atualizar', { metodo: 'POST', token: ADM });
  assert.equal((await call('/v2/loja', { token: loja })).d.recebedor.ativo, true);
  const mens = (await call('/v2/loja/mensalidade', { metodo: 'POST', token: loja })).d;
  const pm = (await call('/v2/pagar', { metodo: 'POST', token: loja, corpo: { tipo: 'mensalidade', id: mens.id, metodo: 'pix' } })).d;
  assert.equal(pm.valor, mens.valor); // mensalidade sem acréscimo (a MOVI absorve a taxa)
  pg.pedidos.get(`or_${pg.n}`).status = 'paid';
  await call(`/v2/cobrancas/${pm.id}`, { token: loja });
  const pao = (await call('/v2/loja/produtos', { metodo: 'POST', token: loja, corpo: { nome: 'Pão francês (10)', preco: 9.5 } })).d;
  await call('/v2/loja', { metodo: 'PUT', token: loja, corpo: { aberta: true } });
  const ped = (await call('/v2/pedidos', { metodo: 'POST', token: cli, corpo: { lojaId: lj.d.id, itens: [{ produtoId: pao.id, qtd: 2 }] } })).d;
  const pp = (await call('/v2/pagar', { metodo: 'POST', token: cli, corpo: { tipo: 'pedido', id: ped.id, metodo: 'pix' } })).d;
  const tp = Math.round(pp.valor * 100), vp = Math.round(ped.total * 100);
  assert.equal(pg.ultimo.items.length, 2); // produto e entrega (a taxa vai embutida na entrega)
  assert.equal(soma(pg.ultimo.items), tp);
  assert.equal(pg.ultimo.items[1].amount, tp - 1900);
  const spp = pg.ultimo.payments[0].split;
  assert.deepEqual([spp[0].recipient_id, spp[0].amount], [rpLoja, 1900]); // loja: os produtos cheios
  assert.ok(spp[1].amount - taxaPg(tp, PIX, 0) >= Math.round(ped.frete * 100)); // MOVI: o frete inteiro
  pg.pedidos.get(`or_${pg.n}`).status = 'paid';
  await call('/webhook/pagarme', { metodo: 'POST', corpo: { type: 'order.paid', data: { id: `or_${pg.n}` } } });
  const pv = (await call(`/v2/pedidos/${ped.id}`, { token: cli })).d;
  assert.equal(pv.status, 'aguardando_loja');
  assert.equal(pv.taxaPagamento, pp.taxa);
  await call(`/v2/loja/pedidos/${ped.id}/recusar`, { metodo: 'POST', token: loja, corpo: { motivo: 'acabou' } });
  const pc = (await call(`/v2/pedidos/${ped.id}`, { token: cli })).d;
  assert.equal(Math.round(pc.reembolso * 100), tp); // devolve tudo, com a taxa
  await call('/v2/disponibilidade');
  assert.equal(pg.estornos.at(-1).amount, tp);

  // chave Pix: qualquer tipo, só com a senha; saques e repasses vão para ela e o Admin é avisado
  assert.match((await call('/v2/eu/pix', { metodo: 'PUT', token: mot, corpo: { tipo: 'email', chave: 'tito@exemplo.com', senha: 'x' } })).d.erro, /Crie a sua senha/);
  await call('/v2/eu/senha', { metodo: 'POST', token: mot, corpo: { nova: 'tito1234' } });
  assert.match((await call('/v2/eu/pix', { metodo: 'PUT', token: mot, corpo: { tipo: 'email', chave: 'tito@', senha: 'tito1234' } })).d.erro, /Chave Pix inválida/);
  assert.equal((await call('/v2/eu/pix', { metodo: 'PUT', token: mot, corpo: { tipo: 'email', chave: 'Tito@Exemplo.com', senha: 'errada' } })).s, 401);
  const tr = await call('/v2/eu/pix', { metodo: 'PUT', token: mot, corpo: { tipo: 'celular', chave: '(47) 96666-2222', senha: 'tito1234' } });
  assert.deepEqual(tr.d, { ok: true, pix: '+5547966662222', pixTipo: 'celular' });
  assert.match(await ultimoAviso(), /CHAVE PIX ALTERADA[\s\S]*Tito Taxa[\s\S]*Celular\): \+5547966662222/);
  const eu = (await call('/v2/eu', { token: mot })).d;
  assert.deepEqual([eu.pix, eu.pixTipo], ['+5547966662222', 'celular']);
  assert.equal((await call('/v2/saldo', { token: mot })).d.chavePix, '+5547966662222');
  assert.ok((await call('/v2/saques', { metodo: 'POST', token: mot })).s === 200); // taxa de deslocamento a sacar
  assert.match(await ultimoAviso(), /SAQUE SOLICITADO[\s\S]*Pix \(Celular\): \+5547966662222/);
  const aleat = '123E4567-E89B-12D3-A456-426614174000';
  assert.match((await call('/v2/loja', { metodo: 'PUT', token: loja, corpo: { pix: 'outra@chave.com' } })).d.erro, /Trocar chave Pix/);
  assert.equal((await call('/v2/loja', { metodo: 'PUT', token: loja, corpo: { pix: (await call('/v2/loja', { token: loja })).d.pix, preparoMin: 25 } })).s, 200); // app antigo mandando a mesma chave
  assert.deepEqual((await call('/v2/eu/pix', { metodo: 'PUT', token: loja, corpo: { tipo: 'aleatoria', chave: aleat, senha: 'pao12345' } })).d, { ok: true, pix: aleat.toLowerCase(), pixTipo: 'aleatoria' });
  assert.equal((await call('/v2/loja/saldo', { token: loja })).d.chavePix, aleat.toLowerCase());
  assert.equal((await call('/v2/eu/pix', { metodo: 'PUT', token: cli, corpo: { tipo: 'cpf', chave: gerarCpf(322233344), senha: 'x' } })).s, 404); // cliente não recebe

  await call('/v2/admin/config', { metodo: 'PUT', token: ADM, corpo: { gateway: 'infinitepay' } });
});

test('cartão salvo (crédito, compra com um clique) e débito com a confirmação do banco (3DS)', async () => {
  assert.equal((await call('/v2/admin/config', { metodo: 'PUT', token: ADM, corpo: { gateway: 'pagarme', taxaPixPct: 0.99, taxaCartaoPct: 4.19, taxaCartaoFixo: 0, taxaDebitoPct: 1.99, debitoAtivo: false } })).s, 200);
  const cfg = (await call('/v2/config')).d;
  assert.equal(cfg.debitoAtivo, false);
  assert.deepEqual(cfg.taxaPreco, { pct: 4.19, fixo: 0 });
  const c = await call('/v2/clientes', { metodo: 'POST', corpo: { nome: 'Nina Cartao', cpf: gerarCpf(355566677), telefone: '47911114444', endereco: 'Rua C, 5, Centro', lat: -26.479, lon: -48.99 } });
  const cli = c.d.token, cliId = c.d.id;
  const mot = (await call('/v2/motoristas', { metodo: 'POST', corpo: { nome: 'Davi Debito', cpf: gerarCpf(366677788), telefone: '47966663333', carro: 'Gol', placa: 'DAV1D23' } })).d;
  await call(`/v2/admin/motoristas/${mot.id}/status`, { metodo: 'POST', token: ADM, corpo: { status: 'aprovado' } });
  await call('/v2/arquivos?tipo=selfie', { metodo: 'POST', token: mot.token, bruto: JPG, tipo: 'image/jpeg' });
  await call('/v2/arquivos?tipo=cnh', { metodo: 'POST', token: mot.token, bruto: JPG, tipo: 'image/jpeg' });
  await call('/v2/eu/livre', { metodo: 'POST', token: mot.token });
  await online(mot.token, COOPER);
  const nova = async () => {
    const x = (await call('/v2/corridas', { metodo: 'POST', token: cli, corpo: { servico: 'comigo', coleta: { localId: 'cooper' }, agendado: false } })).d;
    await call(`/v2/ofertas/${x.id}/aceitar`, { metodo: 'POST', token: mot.token });
    return x;
  };
  const fim = async (id) => { await call(`/v2/corridas/${id}/cancelar`, { metodo: 'POST', token: cli }); await call('/v2/eu/livre', { metodo: 'POST', token: mot.token }); };

  // 1) crédito sem salvar: o cartão sai da carteira da Pagar.me
  const c1 = await nova();
  const p1 = (await call('/v2/pagar', { metodo: 'POST', token: cli, corpo: { tipo: 'corrida', id: c1.id, metodo: 'cartao', cardToken: 'tok_ok', cep: '89270000', salvar: false } })).d;
  assert.equal(p1.status, 'paga');
  assert.equal(pg.ultimo.customer.code, cliId);
  assert.deepEqual(pg.cartoesExcluidos.at(-1), `card_${pg.n}`);
  assert.deepEqual((await call('/v2/cartoes', { token: cli })).d, []);
  await fim(c1.id);

  // 2) crédito salvando: aparece em "Cartões salvos"
  const c2 = await nova();
  const p2 = (await call('/v2/pagar', { metodo: 'POST', token: cli, corpo: { tipo: 'corrida', id: c2.id, metodo: 'cartao', cardToken: 'tok_ok', cep: '89270000', salvar: true } })).d;
  assert.equal(p2.status, 'paga');
  assert.equal(pg.ultimo.customer_id, `cus_${cliId}`); // da segunda vez já usa o cliente da Pagar.me
  const salvos = (await call('/v2/cartoes', { token: cli })).d;
  assert.deepEqual(salvos, [{ id: `card_${pg.n}`, bandeira: 'Mastercard', final: '5100', mes: 8, ano: 2029 }]);
  await fim(c2.id);

  // 3) compra com um clique: só o id do cartão salvo, sem CEP nem token
  const c3 = await nova();
  const p3 = (await call('/v2/pagar', { metodo: 'POST', token: cli, corpo: { tipo: 'corrida', id: c3.id, metodo: 'cartao', cartaoId: salvos[0].id } })).d;
  assert.equal(p3.status, 'paga');
  assert.deepEqual(pg.ultimo.payments[0].credit_card.card_id, salvos[0].id);
  assert.equal(pg.ultimo.payments[0].credit_card.card_token, undefined);
  assert.equal(pg.ultimo.customer_id, `cus_${cliId}`);
  // outro cliente não usa o cartão de ninguém
  const intruso = (await call('/v2/clientes', { metodo: 'POST', corpo: { nome: 'Ivo Intruso', cpf: gerarCpf(377788899), endereco: 'Rua I, 1, Centro', lat: -26.479, lon: -48.99 } })).d.token;
  assert.equal((await call('/v2/pagar', { metodo: 'POST', token: intruso, corpo: { tipo: 'corrida', id: c3.id, metodo: 'cartao', cartaoId: salvos[0].id } })).s, 404);
  assert.equal((await call(`/v2/cartoes/${salvos[0].id}`, { metodo: 'DELETE', token: intruso })).s, 404);
  await fim(c3.id);
  // remover o cartão salvo
  assert.equal((await call(`/v2/cartoes/${salvos[0].id}`, { metodo: 'DELETE', token: cli })).s, 200);
  assert.equal(pg.cartoesExcluidos.at(-1), salvos[0].id);
  assert.deepEqual((await call('/v2/cartoes', { token: cli })).d, []);

  // 4) débito: desligado até o Admin ligar; com 3DS confirmado pelo banco
  const c4 = await nova();
  assert.equal((await call('/v2/pagar/3ds', { metodo: 'POST', token: cli })).s, 409);
  assert.match((await call('/v2/pagar', { metodo: 'POST', token: cli, corpo: { tipo: 'corrida', id: c4.id, metodo: 'debito', cardToken: 'tok_ok', cep: '89270000', tdsTransacao: 'x' } })).d.erro, /débito indisponível/);
  await call('/v2/admin/config', { metodo: 'PUT', token: ADM, corpo: { debitoAtivo: true } });
  assert.equal((await call('/v2/config')).d.debitoAtivo, true);
  const tds = (await call('/v2/pagar/3ds', { metodo: 'POST', token: cli })).d;
  assert.equal(tds.token, `tds_tok_${pg.tds}`);
  assert.equal(tds.ambiente, 'teste');
  assert.equal(tds.cliente.documento, gerarCpf(355566677));
  assert.match((await call('/v2/pagar', { metodo: 'POST', token: cli, corpo: { tipo: 'corrida', id: c4.id, metodo: 'debito', cardToken: 'tok_ok', cep: '89270000' } })).d.erro, /Confirme/);
  const p4 = (await call('/v2/pagar', { metodo: 'POST', token: cli, corpo: { tipo: 'corrida', id: c4.id, metodo: 'debito', cardToken: 'tok_ok', cep: '89270000', tdsTransacao: 'tds-trans-123', email: 'Nina@Exemplo.com' } })).d;
  assert.equal(p4.status, 'paga');
  const pay = pg.ultimo.payments[0];
  assert.equal(pay.payment_method, 'debit_card');
  assert.deepEqual(pay.debit_card.authentication, { type: 'threed_secure', threed_secure: { mpi: 'pagarme', transaction_id: 'tds-trans-123' } });
  assert.equal(pg.ultimo.items.length, 1);
  assert.equal(Math.round(p4.valor * 100), Math.ceil(Math.round(c4.valor * 100) / (1 - 0.0419) - 1e-6)); // mesmo preço do crédito e do Pix
  assert.equal(pg.cartoesExcluidos.at(-1), `card_${pg.n}`); // débito não fica salvo
  assert.equal((await call(`/v2/corridas/${c4.id}`, { token: cli })).d.metodo, 'debit_card');
  assert.equal((await call('/v2/pagar/3ds', { metodo: 'POST', token: cli })).d.cliente.email, 'nina@exemplo.com'); // e-mail guardado
  await fim(c4.id);

  await call('/v2/admin/config', { metodo: 'PUT', token: ADM, corpo: { gateway: 'infinitepay', debitoAtivo: false } });
});
