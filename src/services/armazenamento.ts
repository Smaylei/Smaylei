import AsyncStorage from '@react-native-async-storage/async-storage';
import { TARIFAS_PADRAO } from '../data/tarifas';
import type { Tarifa } from './preco';

const CHAVE_TARIFAS = 'tarifas:v1';
const CHAVE_MARGEM = 'margem:v1';

export async function carregarTarifas(): Promise<Tarifa[]> {
  try {
    const salvo = await AsyncStorage.getItem(CHAVE_TARIFAS);
    if (salvo) return JSON.parse(salvo);
  } catch {}
  return TARIFAS_PADRAO;
}

export async function salvarTarifas(t: Tarifa[]) {
  await AsyncStorage.setItem(CHAVE_TARIFAS, JSON.stringify(t));
}

export async function carregarMargem(): Promise<number> {
  try {
    const salvo = await AsyncStorage.getItem(CHAVE_MARGEM);
    if (salvo) return Number(salvo);
  } catch {}
  return 0;
}

export async function salvarMargem(m: number) {
  await AsyncStorage.setItem(CHAVE_MARGEM, String(m));
}
