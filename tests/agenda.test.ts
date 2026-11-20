import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENDA_PADRAO,
  agoraDisponivel,
  horaLocal,
  horariosLivres,
  horarioValido,
  instante,
  proximosDias,
  type Bloco,
} from '../src/services/agenda.ts';

const cfg = { ...AGENDA_PADRAO };
const DIA = '2026-11-23'; // segunda-feira
const t = (hhmm: string) => instante(DIA, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)));
const madrugada = t('06:00');

test('dia livre oferece horários de 20 em 20 min até 18:20', () => {
  const h = horariosLivres(DIA, cfg, [], madrugada).map(horaLocal);
  assert.equal(h[0], '08:00');
  assert.equal(h[1], '08:20');
  assert.equal(h.at(-1), '18:20'); // 18:20 + 40 min = 19:00
});

test('reserva às 10:00 bloqueia 40 min: 09:40 e 10:20 saem, 09:20 e 10:40 ficam', () => {
  const ocupado: Bloco[] = [{ inicio: t('10:00'), fim: t('10:40') }];
  const h = horariosLivres(DIA, cfg, ocupado, madrugada).map(horaLocal);
  assert.ok(h.includes('09:20'));
  assert.ok(!h.includes('09:40'));
  assert.ok(!h.includes('10:00'));
  assert.ok(!h.includes('10:20'));
  assert.ok(h.includes('10:40'));
});

test('cancelar libera o horário de novo', () => {
  assert.equal(horarioValido(t('10:00'), cfg, [{ inicio: t('10:00'), fim: t('10:40') }], madrugada), false);
  assert.equal(horarioValido(t('10:00'), cfg, [], madrugada), true);
});

test('pedido agora: bloqueado por agendamento próximo, liberado depois', () => {
  const ocupado: Bloco[] = [{ inicio: t('14:20'), fim: t('15:00') }];
  assert.equal(agoraDisponivel(cfg, ocupado, t('14:00')).ok, false); // 14:00–14:40 bate com 14:20
  assert.equal(agoraDisponivel(cfg, ocupado, t('15:00')).ok, true);
  assert.equal(agoraDisponivel(cfg, [], t('07:00')).ok, false); // fora do horário
  assert.equal(agoraDisponivel({ ...cfg, aberto: false }, [], t('10:00')).ok, false);
});

test('antecedência mínima de 30 min e fechado não oferece dias', () => {
  const h = horariosLivres(DIA, cfg, [], t('10:05')).map(horaLocal);
  assert.equal(h[0], '10:40');
  assert.deepEqual(proximosDias({ ...cfg, aberto: false }, [], madrugada), []);
  assert.equal(proximosDias(cfg, [], madrugada)[0].rotulo, 'Hoje 23/11');
});
