import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { MODO, trocarModo, type Modo } from '../variante';
import { COR_PERFIL, cores } from './tema';

const NOME: Record<Modo, string> = { cliente: 'CLIENTE', motorista: 'MOTORISTA', lojista: 'LOJISTA', admin: 'ADMIN' };
const logo = require('../../assets/movi-logo.png');

/** Logo MOVI com o nome do perfil entre linhas, na cor do perfil (identidade visual). */
export function Marca({ perfil = MODO, largura = 220, slogan }: { perfil?: Modo | null; largura?: number; slogan?: boolean }) {
  const cor = perfil ? (perfil === 'cliente' ? '#FFFFFF' : COR_PERFIL[perfil]) : cores.suave;
  return (
    <View style={{ alignItems: 'center', gap: Math.round(largura * 0.04) }}>
      <Image source={logo} style={{ width: largura, height: largura * 0.176 }} resizeMode="contain" accessibilityLabel="MOVI" />
      {!perfil && slogan && (
        <Text style={[s.sub, { color: cores.suave, fontSize: Math.max(10, largura * 0.052), letterSpacing: largura * 0.016 }]}>SUA CIDADE EM MOVIMENTO</Text>
      )}
      {perfil && (
        <View style={s.linha}>
          <View style={[s.traco, { backgroundColor: cor }]} />
          <Text style={[s.sub, { color: cor, fontSize: Math.max(10, largura * 0.06), letterSpacing: largura * 0.03 }]}>
            {NOME[perfil]}
          </Text>
          <View style={[s.traco, { backgroundColor: cor }]} />
        </View>
      )}
    </View>
  );
}

/** Logo pequeno para o cabeçalho das telas. */
export function MarcaTopo() {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Image source={logo} style={{ width: 74, height: 13 }} resizeMode="contain" accessibilityLabel="MOVI" />
      {MODO && <Text style={[s.topo, { color: MODO === 'cliente' ? '#FFFFFF' : COR_PERFIL[MODO] }]}>{NOME[MODO]}</Text>}
    </View>
  );
}

/** Volta à escolha de perfil (para quem tem mais de uma conta: cliente, motorista, lojista). */
export function BotaoInicio() {
  return (
    <Pressable onPress={() => trocarModo(null)} hitSlop={12} style={s.inicio} accessibilityLabel="Início: trocar de perfil">
      <MaterialCommunityIcons name="home-variant" size={20} color={cores.texto} />
      <Text style={s.inicioTexto}>Início</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  linha: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  traco: { height: 2, width: 36, borderRadius: 1 },
  sub: { fontWeight: '700' },
  topo: { fontSize: 11, fontWeight: '800', letterSpacing: 2 },
  inicio: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingRight: 8 },
  inicioTexto: { color: cores.texto, fontWeight: '600', fontSize: 15 },
});
