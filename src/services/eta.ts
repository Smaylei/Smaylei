import { useEffect, useState } from 'react';
import { SOLICITANTE, MODO } from '../variante';
import { api } from './api';

type Ponto = { lat: number; lon: number };
export type Rota = { km: number; min: number; caminho: [number, number][] };

const cache = new Map<string, Rota>();
const papel = () => (MODO === 'motorista' ? 'motorista' : MODO === 'admin' ? 'admin' : SOLICITANTE);

/** Rota de carro e tempo estimado (OSRM pelo servidor), para a chegada e a linha no mapa. */
export async function rotaAte(origem: Ponto, destino: Ponto): Promise<Rota | null> {
  const k = `${origem.lat.toFixed(3)},${origem.lon.toFixed(3)}|${destino.lat.toFixed(4)},${destino.lon.toFixed(4)}`;
  if (cache.has(k)) return cache.get(k)!;
  try {
    const r = await api<Rota>(papel(), `/v2/rota?de=${origem.lat},${origem.lon}&para=${destino.lat},${destino.lon}`);
    cache.set(k, r);
    return r;
  } catch {
    return null;
  }
}

/** Hook: recalcula só quando a origem anda ~100 m (coordenadas arredondadas). */
export function useRota(origem: Ponto | null | undefined, destino: Ponto | null | undefined, ativo = true) {
  const [r, setR] = useState<Rota | null>(null);
  const la = origem ? Math.round(origem.lat * 1e3) / 1e3 : null, lo = origem ? Math.round(origem.lon * 1e3) / 1e3 : null;
  const lb = destino?.lat ?? null, lob = destino?.lon ?? null;
  useEffect(() => {
    let vivo = true;
    if (!ativo || la == null || lo == null || lb == null || lob == null) {
      const t = setTimeout(() => vivo && setR(null), 0);
      return () => clearTimeout(t);
    }
    rotaAte({ lat: la, lon: lo }, { lat: lb, lon: lob }).then((x) => vivo && setR(x));
    return () => {
      vivo = false;
    };
  }, [la, lo, lb, lob, ativo]);
  return r;
}
