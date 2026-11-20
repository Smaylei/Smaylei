// A migração do fluxo antigo (pagar no mercado) para o novo não pode perder o ganho do motorista.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Central } from '../.teste/worker.mjs';

test('corrida antiga paga vira entregue e o ganho entra no saldo do motorista', () => {
  const db = new DatabaseSync(':memory:');
  const sql = { exec(q, ...a) { const st = db.prepare(q); const l = /^\s*(SELECT|WITH)/i.test(q) ? st.all(...a) : (st.run(...a), []); return { toArray: () => l }; } };
  const ctx = { storage: { sql }, blockConcurrencyWhile: (fn) => fn(), waitUntil: () => {} };
  // banco no formato antigo
  new Central(ctx, {}); // cria o esquema
  db.exec(`DELETE FROM config`);
  db.exec(`INSERT INTO motoristas (id, token, nome, cpf, telefone, carro, placa, status, criado_em) VALUES ('m1','t','Smaylei','15350946056','47999149325','Strada','ABC1D23','aprovado','2026-11-20')`);
  db.exec(`INSERT INTO corridas (id, cliente_id, motorista_id, mercado_id, mercado_nome, agendado, inicio, fim, janela, status, valor, km, minutos, ganho_motorista, repassado, criado_em, pago_em)
           VALUES ('c1','cli','m1','cooper','Cooper',0,'2026-11-20T18:00:00Z','2026-11-20T18:40:00Z','Agora','pago',19.8,8,15,15.84,0,'2026-11-20T18:00:00Z','2026-11-20T18:43:00Z'),
                  ('c2','cli','m1','cooper','Cooper',0,'2026-11-20T19:00:00Z','2026-11-20T19:40:00Z','Agora','aguardando_pagamento',20,8,15,NULL,0,'2026-11-20T19:00:00Z',NULL)`);
  const c = new Central(ctx, {});
  assert.equal(db.prepare(`SELECT status FROM corridas WHERE id='c1'`).get().status, 'entregue');
  assert.equal(db.prepare(`SELECT status FROM corridas WHERE id='c2'`).get().status, 'cancelado');
  assert.equal(c.saldo('m1').disponivel, 15.84);
  new Central(ctx, {}); // roda de novo: não duplica
  assert.equal(c.saldo('m1').disponivel, 15.84);
});
