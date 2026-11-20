import Constants from 'expo-constants';

/** Qual app está rodando: o do cliente ou o App Admin (APP_VARIANT=admin no build). */
export const VARIANTE: 'cliente' | 'admin' = Constants.expoConfig?.extra?.variante === 'admin' ? 'admin' : 'cliente';
export const EH_ADMIN = VARIANTE === 'admin';
