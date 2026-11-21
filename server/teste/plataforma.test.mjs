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
  DOCS: {
    put: async (k, v, o) => void arquivos.set(k, { v, ct: o?.httpMetadata?.contentType }),
    get: async (k) => (arquivos.has(k) ? { body: arquivos.get(k).v, httpMetadata: { contentType: arquivos.get(k).ct } } : null),
  },
};
const central = new Central(ctx, env);
env.CENTRAL = { idFromName: () => 'x', get: () => ({ fetch: (r) => central.fetch(r) }) };
let linkCriado;
globalThis.fetch = async (url, init) => {
  url = String(url);
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
  assert.equal(depois.disponivel, Math.round((antes.disponivel + Math.round(bu.d.valor * 0.8 * 100) / 100) * 100) / 100);
  await call('/v2/eu/livre', { metodo: 'POST', token: motorista });

  // encomenda: endereço livre, fora da área é recusado
  const fora = await call('/v2/corridas', { metodo: 'POST', token: cli2, corpo: { servico: 'encomenda', coleta: { endereco: 'Rua das Flores, 10, Joinville', lat: -26.30, lon: -48.85 }, descricao: 'Caixa', agendado: false } });
  assert.equal(fora.s, 400);
  assert.match(fora.d.erro, /fora da área/);
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
