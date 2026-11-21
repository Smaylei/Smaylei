import { Platform, type ViewStyle } from 'react-native';
import { VARIANTE } from '../variante';

/**
 * Visual suave e limpo, comum aos três apps. Cada app tem a sua cor de destaque:
 * cliente = verde-sálvia, motorista parceiro = azul sereno, admin = índigo.
 */
const DESTAQUE = {
  cliente: { primaria: '#2E8A5E', primariaClara: '#EAF5EF', primariaMedia: '#CFE8DA' },
  motorista: { primaria: '#3D6FD1', primariaClara: '#ECF2FD', primariaMedia: '#D3E0F8' },
  admin: { primaria: '#5560C4', primariaClara: '#EFF0FB', primariaMedia: '#D9DCF5' },
}[VARIANTE];

export const cores = {
  fundo: '#F6F7F5',
  cartao: '#FFFFFF',
  texto: '#1E2925',
  suave: '#6A7570',
  apagado: '#9AA4A0',
  borda: '#E7EBE8',
  ...DESTAQUE,
  /** Texto secundário sobre fundo da cor de destaque. */
  sobrePrimaria: 'rgba(255,255,255,0.82)',
  uber: '#000000',
  noventaENove: '#FFC700',
  alerta: '#A0670A',
  alertaFundo: '#FFF6E5',
  sucesso: '#2E8A5E',
  sucessoFundo: '#EAF5EF',
  erro: '#C2412D',
  erroFundo: '#FDEEEB',
  estrela: '#F2B33D',
};

export const raio = 18;

/** Sombra leve para cartões (no lugar de bordas fortes). */
export const sombra: ViewStyle = Platform.select({
  android: { elevation: 2, shadowColor: '#1E2925' },
  default: { shadowColor: '#1E2925', shadowOpacity: 0.06, shadowRadius: 14, shadowOffset: { width: 0, height: 4 } },
}) as ViewStyle;
