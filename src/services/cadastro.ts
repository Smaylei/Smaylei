import AsyncStorage from '@react-native-async-storage/async-storage';

export type Endereco = { nome: string; endereco: string; telefone?: string; cpf?: string; temFoto?: boolean; lat: number; lon: number };

// Endereço do cliente (casa) e da loja (lojista) ficam separados no aparelho.
const CHAVE = { cliente: 'cadastro:casa:v1', lojista: 'cadastro:loja:v1' };

export async function carregarEndereco(quem: 'cliente' | 'lojista' = 'cliente'): Promise<Endereco | null> {
  try {
    const s = await AsyncStorage.getItem(CHAVE[quem]);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

export async function salvarEndereco(e: Endereco, quem: 'cliente' | 'lojista' = 'cliente') {
  await AsyncStorage.setItem(CHAVE[quem], JSON.stringify(e));
}
