// Cidades atendidas. Área de cada uma: retângulo do município (OpenStreetMap). O Admin liga/desliga.
export type CidadeId = 'guaramirim' | 'jaragua' | 'schroeder' | 'massaranduba' | 'joinville';
type Ponto = { lat: number; lon: number };

export const CIDADES: { id: CidadeId; nome: string; centro: Ponto; caixa: [number, number, number, number] }[] = [
  { id: 'guaramirim', nome: 'Guaramirim', centro: { lat: -26.4745, lon: -48.9981 }, caixa: [-26.5739, -26.3735, -49.0515, -48.8314] },
  { id: 'jaragua', nome: 'Jaraguá do Sul', centro: { lat: -26.4897, lon: -49.0778 }, caixa: [-26.6489, -26.2166, -49.2974, -49.0147] },
  { id: 'schroeder', nome: 'Schroeder', centro: { lat: -26.4116, lon: -49.074 }, caixa: [-26.4576, -26.2613, -49.1462, -48.979] },
  { id: 'massaranduba', nome: 'Massaranduba', centro: { lat: -26.6109, lon: -49.0054 }, caixa: [-26.7735, -26.5154, -49.1143, -48.8516] },
  { id: 'joinville', nome: 'Joinville', centro: { lat: -26.3045, lon: -48.8487 }, caixa: [-26.4521, -26.0742, -49.2008, -48.7233] },
];

export const nomeCidade = (id: unknown) => CIDADES.find((c) => c.id === id)?.nome ?? '';

/** Cidade do ponto (a mais próxima entre as que contêm o ponto), ou null se fora da região. */
export function cidadeDe(p: Ponto): CidadeId | null {
  const dentro = CIDADES.filter((c) => p.lat >= c.caixa[0] && p.lat <= c.caixa[1] && p.lon >= c.caixa[2] && p.lon <= c.caixa[3]);
  if (!dentro.length) return null;
  const d = (c: (typeof CIDADES)[number]) => (c.centro.lat - p.lat) ** 2 + ((c.centro.lon - p.lon) * Math.cos((p.lat * Math.PI) / 180)) ** 2;
  return dentro.sort((a, b) => d(a) - d(b))[0].id;
}
