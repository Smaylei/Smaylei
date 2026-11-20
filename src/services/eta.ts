import { rotasAteCasa, type Ponto } from './grafo';

/** Rota e tempo estimado de um ponto (motorista) até outro (mercado ou cliente), pelas ruas. */
export function rotaAte(origem: Ponto, destino: Ponto) {
  const r = rotasAteCasa(destino, [{ id: 'o', ...origem }]).o;
  if (!r) return null;
  return { km: r.kmIda, min: Math.max(1, Math.round(r.minIda)), caminho: r.ida };
}
