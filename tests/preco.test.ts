import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distanciaRetaKm, estimarIdaEVolta, formatarReais, precoSugerido, type Tarifa } from '../src/services/preco.ts';

const uber: Tarifa = { id: 'u', plataforma: 'Uber', categoria: 'UberX', tarifaBase: 2, porKm: 1.35, porMinuto: 0.26, tarifaMinima: 7 };
const pop: Tarifa = { id: 'p', plataforma: '99', categoria: '99Pop', tarifaBase: 2.3, porKm: 1.3, porMinuto: 0.22, tarifaMinima: 6.5 };

test('soma ida e volta e cobra km + minuto + base', () => {
  const e = estimarIdaEVolta({ kmIda: 4, kmVolta: 4.2, minIda: 9, minVolta: 10 }, uber);
  assert.equal(e.kmTotal, 8.2);
  assert.equal(e.minTotal, 19);
  assert.equal(e.valorKm, 11.07); // 8,2 × 1,35
  assert.equal(e.valorTempo, 4.94); // 19 × 0,26
  assert.equal(e.valor, 18.01); // 2 + 11,07 + 4,94
  assert.equal(e.aplicouMinima, false);
});

test('aplica tarifa mínima em trajetos curtos', () => {
  const e = estimarIdaEVolta({ kmIda: 0.5, kmVolta: 0.5, minIda: 2, minVolta: 2 }, pop);
  assert.equal(e.aplicouMinima, true);
  assert.equal(e.valor, 6.5);
});

test('preço sugerido é a média com margem', () => {
  const t = { kmIda: 5, kmVolta: 5, minIda: 10, minVolta: 10 };
  const es = [estimarIdaEVolta(t, uber), estimarIdaEVolta(t, pop)];
  // Uber: 2 + 13,5 + 5,2 = 20,70 · 99: 2,3 + 13 + 4,4 = 19,70 · média 20,20
  assert.equal(precoSugerido(es, 0), 20.2);
  assert.equal(precoSugerido(es, 10), 22.22);
  assert.equal(precoSugerido([], 10), 0);
});

test('distância em linha reta (Guaramirim → Jaraguá do Sul ≈ 7 km em linha reta)', () => {
  const d = distanciaRetaKm(-26.4729, -49.0026, -26.4851, -49.0713);
  assert.ok(d > 6 && d < 8, `obtido ${d}`);
});

test('formata reais no padrão brasileiro', () => {
  assert.equal(formatarReais(1234.5), 'R$ 1.234,50');
});
