import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * MOVI é um app só: ao abrir, a pessoa escolhe o perfil (Cliente, Motorista ou Lojista). O perfil
 * fica salvo e é lido de forma síncrona na abertura, para o tema (cores) já nascer certo. Trocar de
 * perfil pelo botão "Início" recarrega o app. O painel Admin é a versão web (APP_VARIANT=admin).
 */
export type Modo = 'cliente' | 'motorista' | 'lojista' | 'admin';

export const EH_ADMIN = Constants.expoConfig?.extra?.variante === 'admin';
const CHAVE_MODO = 'movi_modo';

function lerModo(): Modo | null {
  if (EH_ADMIN) return 'admin';
  try {
    const m = Platform.OS === 'web' ? globalThis.localStorage?.getItem(CHAVE_MODO) : SecureStore.getItem(CHAVE_MODO);
    return m === 'cliente' || m === 'motorista' || m === 'lojista' ? m : null;
  } catch {
    return null;
  }
}

/** Perfil em uso nesta abertura do app (null = ainda vai escolher). */
export const MODO = lerModo();
/** Compatível com o código antigo (três apps separados). */
export const VARIANTE: Modo = MODO ?? 'cliente';
/** Quem pede corridas neste perfil: a pessoa ou a loja (as rotas do servidor são as mesmas). */
export const SOLICITANTE: 'cliente' | 'lojista' = MODO === 'lojista' ? 'lojista' : 'cliente';

/** Troca de perfil (ou volta à escolha, com null) e recarrega o app. */
export async function trocarModo(m: Modo | null) {
  if (Platform.OS === 'web') {
    if (m) globalThis.localStorage?.setItem(CHAVE_MODO, m);
    else globalThis.localStorage?.removeItem(CHAVE_MODO);
    globalThis.location?.reload();
    return;
  }
  if (m) SecureStore.setItem(CHAVE_MODO, m);
  else await SecureStore.deleteItemAsync(CHAVE_MODO);
  const { reloadAppAsync } = await import('expo');
  await reloadAppAsync('troca de perfil');
}
