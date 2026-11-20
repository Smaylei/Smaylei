// Cálculo de preço puro (sem dependências) para poder ser testado com `node --test`.

export type Tarifa = {
  id: string;
  plataforma: 'Uber' | '99';
  categoria: string;
  tarifaBase: number; // R$ fixo por corrida
  porKm: number; // R$ por km rodado
  porMinuto: number; // R$ por minuto de viagem
  tarifaMinima: number; // R$ valor mínimo da corrida
};

export type Trajeto = {
  kmIda: number;
  kmVolta: number;
  minIda: number;
  minVolta: number;
};

export type Estimativa = {
  tarifa: Tarifa;
  kmTotal: number;
  minTotal: number;
  valorKm: number;
  valorTempo: number;
  valor: number; // valor final (já com tarifa mínima aplicada)
  aplicouMinima: boolean;
};

const centavos = (v: number) => Math.round(v * 100) / 100;

/**
 * Preço de uma entrega com retorno: o motorista sai do mercado, vai até o
 * cliente e volta ao mercado. Cobra-se uma tarifa base e o km/minuto de todo
 * o percurso (ida + volta), como se fosse uma corrida contínua.
 */
export function estimarIdaEVolta(trajeto: Trajeto, tarifa: Tarifa): Estimativa {
  const kmTotal = trajeto.kmIda + trajeto.kmVolta;
  const minTotal = trajeto.minIda + trajeto.minVolta;
  const valorKm = kmTotal * tarifa.porKm;
  const valorTempo = minTotal * tarifa.porMinuto;
  const bruto = tarifa.tarifaBase + valorKm + valorTempo;
  const aplicouMinima = bruto < tarifa.tarifaMinima;
  return {
    tarifa,
    kmTotal: centavos(kmTotal),
    minTotal: Math.round(minTotal),
    valorKm: centavos(valorKm),
    valorTempo: centavos(valorTempo),
    valor: centavos(aplicouMinima ? tarifa.tarifaMinima : bruto),
    aplicouMinima,
  };
}

/** Média das estimativas, acrescida da margem do app (em %). */
export function precoSugerido(estimativas: Estimativa[], margemPct: number): number {
  if (estimativas.length === 0) return 0;
  const media = estimativas.reduce((s, e) => s + e.valor, 0) / estimativas.length;
  return centavos(media * (1 + margemPct / 100));
}

/** Distância em linha reta (km) entre dois pontos — usada só como plano B. */
export function distanciaRetaKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export const formatarReais = (v: number) =>
  'R$ ' + v.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');

export const formatarKm = (v: number) => v.toFixed(1).replace('.', ',') + ' km';
