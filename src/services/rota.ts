import * as Location from 'expo-location';

export type Ponto = { lat: number; lon: number };

const USER_AGENT = 'MercadoFrete/1.0 (app de entregas de compras)';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

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

export async function minhaLocalizacao(): Promise<Ponto> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') throw new Error('Permissão de localização negada.');
  const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  return { lat: pos.coords.latitude, lon: pos.coords.longitude };
}
