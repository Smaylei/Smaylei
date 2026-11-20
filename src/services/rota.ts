import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import type { Mercado } from '../data/mercados';
import { distanciaRetaKm, type Trajeto } from './preco';

export type Ponto = { lat: number; lon: number };
export type ResultadoRota = Trajeto & { fonte: 'rota' | 'estimada' };

const USER_AGENT = 'MercadoFrete/1.0 (app de entregas de compras)';
// Servidor público de demonstração do OSRM. Para produção, use um servidor
// próprio ou a Google Directions API (com chave).
const OSRM = 'https://router.project-osrm.org/route/v1/driving';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

// Plano B quando não houver internet/rota: linha reta × fator de sinuosidade
// das ruas e velocidade média urbana.
const FATOR_RUAS = 1.35;
const VELOCIDADE_MEDIA_KMH = 35;

async function geocodeNominatim(endereco: string): Promise<Ponto | null> {
  const url = `${NOMINATIM}?format=json&limit=1&countrycodes=br&q=${encodeURIComponent(endereco)}`;
  const resp = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
  if (!resp.ok) return null;
  const dados: { lat: string; lon: string }[] = await resp.json();
  return dados[0] ? { lat: Number(dados[0].lat), lon: Number(dados[0].lon) } : null;
}

/** Converte um endereço em coordenadas: geocodificador do celular, depois OpenStreetMap. */
export async function geocodificar(endereco: string): Promise<Ponto | null> {
  try {
    const r = await Location.geocodeAsync(endereco);
    if (r[0]) return { lat: r[0].latitude, lon: r[0].longitude };
  } catch {
    // segue para o plano B
  }
  try {
    return await geocodeNominatim(endereco);
  } catch {
    return null;
  }
}

/** Coordenadas do mercado, com cache local para não geocodificar toda vez. */
export async function pontoDoMercado(m: Mercado): Promise<Ponto> {
  const chave = `mercado:${m.id}`;
  try {
    const salvo = await AsyncStorage.getItem(chave);
    if (salvo) return JSON.parse(salvo);
  } catch {}
  const p = await geocodificar(m.endereco);
  if (p) {
    AsyncStorage.setItem(chave, JSON.stringify(p)).catch(() => {});
    return p;
  }
  return { lat: m.latAprox, lon: m.lonAprox };
}

export async function minhaLocalizacao(): Promise<Ponto> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') throw new Error('Permissão de localização negada.');
  const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  return { lat: pos.coords.latitude, lon: pos.coords.longitude };
}

/** Rota mercado → cliente → mercado, com km e minutos de cada trecho. */
export async function calcularIdaEVolta(mercado: Ponto, cliente: Ponto): Promise<ResultadoRota> {
  const coords = [mercado, cliente, mercado].map((p) => `${p.lon},${p.lat}`).join(';');
  try {
    const resp = await fetch(`${OSRM}/${coords}?overview=false`, { headers: { 'User-Agent': USER_AGENT } });
    const dados = await resp.json();
    if (dados.code === 'Ok' && dados.routes?.[0]?.legs?.length === 2) {
      const [ida, volta] = dados.routes[0].legs as { distance: number; duration: number }[];
      return {
        kmIda: ida.distance / 1000,
        kmVolta: volta.distance / 1000,
        minIda: ida.duration / 60,
        minVolta: volta.duration / 60,
        fonte: 'rota',
      };
    }
  } catch {
    // sem internet ou servidor indisponível
  }
  const km = distanciaRetaKm(mercado.lat, mercado.lon, cliente.lat, cliente.lon) * FATOR_RUAS;
  const min = (km / VELOCIDADE_MEDIA_KMH) * 60;
  return { kmIda: km, kmVolta: km, minIda: min, minVolta: min, fonte: 'estimada' };
}
