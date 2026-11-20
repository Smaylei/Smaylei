import type { Tarifa } from '../services/preco';

/*
 * Uber e 99 NÃO oferecem API pública de preços nem publicam tabela oficial por
 * cidade (o valor final muda com demanda e horário). Os valores abaixo são
 * pontos de partida baseados em referências públicas para Joinville/região e
 * médias nacionais de 2026:
 *  - UberX Joinville (estimativa de terceiros): base R$ 2,00; R$ 1,10–1,20/km;
 *    R$ 0,20–0,24/min; mínima R$ 6,00.
 *  - Média UberX 2026 em capitais: R$ 1,20–1,80/km; R$ 0,25–0,40/min.
 *  - 99Pop (tabela antiga divulgada): base R$ 2,38; R$ 1,14/km; R$ 0,19/min;
 *    mínima R$ 5,70. Média de mercado 2026: R$ 1,20–1,50/km.
 *
 * Calibre na aba "Tarifas": simule a mesma corrida no app da Uber e da 99 e
 * ajuste os campos até o valor bater.
 */
export const TARIFAS_PADRAO: Tarifa[] = [
  { id: 'uberx', plataforma: 'Uber', categoria: 'UberX', tarifaBase: 2.0, porKm: 1.35, porMinuto: 0.26, tarifaMinima: 7.0 },
  { id: '99pop', plataforma: '99', categoria: '99Pop', tarifaBase: 2.3, porKm: 1.3, porMinuto: 0.22, tarifaMinima: 6.5 },
];
