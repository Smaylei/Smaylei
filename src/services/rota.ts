import * as Location from 'expo-location';
import { cidadeDe, nomeCidade, type CidadeId } from '../data/cidades';

export type Ponto = { lat: number; lon: number };

const USER_AGENT = 'MOVI/1.0 (app de mobilidade urbana)';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

// Região atendida (Guaramirim, Jaraguá do Sul, Schroeder, Massaranduba, Joinville).
const REGIAO = '-49.30,-26.07,-48.72,-26.78';

async function geocodeNominatim(endereco: string): Promise<Ponto | null> {
  const url = `${NOMINATIM}?format=json&limit=1&countrycodes=br&viewbox=${REGIAO}&bounded=1&q=${encodeURIComponent(endereco)}`;
  const resp = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
  if (!resp.ok) return null;
  const dados: { lat: string; lon: string }[] = await resp.json();
  return dados[0] ? { lat: Number(dados[0].lat), lon: Number(dados[0].lon) } : null;
}

/** Converte um endereço da cidade escolhida em coordenadas: geocodificador do celular, depois OpenStreetMap. */
export async function geocodificar(endereco: string, cidade?: CidadeId | null): Promise<Ponto | null> {
  const nome = nomeCidade(cidade);
  const q = nome && !endereco.toLowerCase().includes(nome.toLowerCase()) ? `${endereco}, ${nome} - SC` : endereco;
  try {
    const r = await Location.geocodeAsync(q);
    if (r[0] && cidadeDe({ lat: r[0].latitude, lon: r[0].longitude })) return { lat: r[0].latitude, lon: r[0].longitude };
  } catch {
    // segue para o plano B
  }
  try {
    return await geocodeNominatim(q);
  } catch {
    return null;
  }
}

export async function minhaLocalizacao(): Promise<Ponto> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') throw new Error('Permissão de localização negada.');
  const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  return { lat: pos.coords.latitude, lon: pos.coords.longitude };
}
