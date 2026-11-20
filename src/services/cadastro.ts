import AsyncStorage from '@react-native-async-storage/async-storage';

export type Endereco = { nome: string; endereco: string; telefone?: string; lat: number; lon: number };

const CHAVE = 'cadastro:casa:v1';

export async function carregarEndereco(): Promise<Endereco | null> {
  try {
    const s = await AsyncStorage.getItem(CHAVE);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

export async function salvarEndereco(e: Endereco) {
  await AsyncStorage.setItem(CHAVE, JSON.stringify(e));
}
