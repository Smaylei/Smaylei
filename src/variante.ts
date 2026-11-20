import Constants from 'expo-constants';

/** Qual app está rodando (APP_VARIANT no build): cliente, motorista parceiro ou admin. */
const v = Constants.expoConfig?.extra?.variante;
export const VARIANTE: 'cliente' | 'motorista' | 'admin' = v === 'admin' || v === 'motorista' ? v : 'cliente';
export const EH_ADMIN = VARIANTE === 'admin';
