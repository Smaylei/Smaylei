import type { ViewStyle } from 'react-native';
import { MODO } from '../variante';

/**
 * Identidade MOVI: fundo escuro, marca branca e uma cor por perfil
 * (Cliente verde, Motorista azul, Lojista laranja, Admin cinza). A cor vem do perfil escolhido
 * ao abrir o app; trocar de perfil recarrega o app com a nova cor.
 */
export const COR_PERFIL = { cliente: '#2DB36F', motorista: '#1E7BFF', lojista: '#F27B1A', admin: '#7C8691' } as const;

const destaque = (cor: string) => ({ primaria: cor, primariaClara: `${cor}24`, primariaMedia: `${cor}59` });

export const cores = {
  fundo: '#0A0B0D',
  cartao: '#15171B',
  cartaoAlto: '#1D2025',
  texto: '#F3F5F6',
  suave: '#9BA3AA',
  apagado: '#6B737A',
  borda: '#262A30',
  ...destaque(MODO ? COR_PERFIL[MODO] : '#F3F5F6'),
  /** Texto secundário sobre fundo da cor de destaque. */
  sobrePrimaria: 'rgba(255,255,255,0.85)',
  uber: '#000000',
  noventaENove: '#FFC700',
  alerta: '#F5B941',
  alertaFundo: 'rgba(245,185,65,0.12)',
  sucesso: '#34C77B',
  sucessoFundo: 'rgba(52,199,123,0.12)',
  erro: '#FF6B5F',
  erroFundo: 'rgba(255,107,95,0.12)',
  estrela: '#F5B941',
};

/** Texto sobre os botões coloridos (o branco do perfil neutro pede texto escuro). */
export const textoSobrePrimaria = MODO ? '#FFFFFF' : '#0A0B0D';

export const raio = 18;

/** No tema escuro, contorno sutil no lugar de sombra. */
export const sombra: ViewStyle = { borderWidth: 1, borderColor: '#23272D' };
