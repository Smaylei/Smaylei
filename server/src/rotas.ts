// Rotas de carro sem Google: OSRM (OpenStreetMap). O servidor público do OSRM é para testes;
// em produção troque OSRM_URL por um servidor próprio (OSRM/Valhalla com o mapa de SC) ou um
// provedor pago (Stadia, OpenRouteService, Mapbox) — o resto do código não muda.
export const OSRM_URL = 'https://router.project-osrm.org';

export type Ponto = { lat: number; lon: number };
export type Trajeto = { kmIda: number; kmVolta: number; minIda: number; minVolta: number };

const coord = (p: Ponto) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`;

async function buscar<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'MOVI/1.0 (mobilidade urbana, teste)' }, signal: AbortSignal.timeout(7000) });
    if (!r.ok) return null;
    const d = (await r.json()) as { code?: string } & T;
    return d.code === 'Ok' ? d : null;
  } catch {
    return null;
  }
}

/** Ida e volta entre a base e cada ponto, numa chamada só (matriz de distâncias). */
export async function tabelaOsrm(base: Ponto, pontos: Ponto[]): Promise<(Trajeto | null)[]> {
  if (!pontos.length) return [];
  const d = await buscar<{ distances: (number | null)[][]; durations: (number | null)[][] }>(
    `${OSRM_URL}/table/v1/driving/${[base, ...pontos].map(coord).join(';')}?annotations=distance,duration`,
  );
  if (!d) return pontos.map(() => null);
  return pontos.map((_, i) => {
    const j = i + 1;
    const [di, dv, ti, tv] = [d.distances[0][j], d.distances[j][0], d.durations[0][j], d.durations[j][0]];
    if (di == null || dv == null || ti == null || tv == null) return null;
    return { kmIda: di / 1000, kmVolta: dv / 1000, minIda: ti / 60, minVolta: tv / 60 };
  });
}

/** Caminho de carro de A até B (para desenhar no mapa e calcular a chegada). */
export async function caminhoOsrm(a: Ponto, b: Ponto) {
  const d = await buscar<{ routes: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[] }>(
    `${OSRM_URL}/route/v1/driving/${coord(a)};${coord(b)}?overview=simplified&geometries=geojson`,
  );
  const r = d?.routes?.[0];
  if (!r) return null;
  return { km: r.distance / 1000, min: r.duration / 60, caminho: r.geometry.coordinates.map(([lon, lat]) => [lat, lon] as [number, number]) };
}

/** Reserva sem internet: linha reta × 1,35 a 35 km/h. */
export function trajetoEstimado(a: Ponto, b: Ponto): Trajeto {
  const R = 6371, rad = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2;
  const km = 2 * R * Math.asin(Math.sqrt(h)) * 1.35;
  return { kmIda: km, kmVolta: km, minIda: (km / 35) * 60, minVolta: (km / 35) * 60 };
}
