import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Redirect } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Marca } from '../components/Marca';
import { COR_PERFIL, cores } from '../components/tema';
import { EH_ADMIN, MODO, trocarModo, type Modo } from '../variante';

const OPCOES: { modo: Modo; titulo: string; sub: string; icone: keyof typeof MaterialCommunityIcons.glyphMap }[] = [
  { modo: 'cliente', titulo: 'CLIENTE', sub: 'Solicitar transportes', icone: 'account' },
  { modo: 'motorista', titulo: 'MOTORISTA', sub: 'Realizar transportes de carro ou moto', icone: 'car' },
  { modo: 'lojista', titulo: 'LOJISTA', sub: 'Solicitar transporte de compras e clientes', icone: 'storefront' },
];

/** Abertura do app: a pessoa escolhe como quer usar a MOVI (o Admin é só no computador). O perfil fica salvo até tocar em "Início". */
export default function Inicio() {
  const insets = useSafeAreaInsets();
  if (EH_ADMIN) return <Redirect href="/painel" />;
  if (MODO === 'cliente') return <Redirect href="/cliente" />;
  if (MODO === 'motorista') return <Redirect href="/motorista" />;
  if (MODO === 'lojista') return <Redirect href="/lojista" />;

  return (
    <ScrollView contentContainerStyle={[s.conteudo, { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 30 }]}>
      <Marca perfil={null} largura={240} slogan />
      <Text style={s.pergunta}>Como você deseja utilizar a MOVI?</Text>
      <View style={s.grade}>
        {OPCOES.map((o) => {
          const cor = COR_PERFIL[o.modo];
          return (
            <Pressable
              key={o.modo}
              style={({ pressed }) => [s.cartao, { backgroundColor: `${cor}2E`, borderLeftColor: cor }, pressed && { opacity: 0.8 }]}
              onPress={() => trocarModo(o.modo)}
              accessibilityRole="button"
            >
              <MaterialCommunityIcons name={o.icone} size={34} color="#FFFFFF" />
              <View style={s.divisor} />
              <View style={{ flex: 1 }}>
                <Text style={s.titulo}>{o.titulo}</Text>
                <Text style={s.sub}>{o.sub}</Text>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={26} color="#FFFFFF" />
            </Pressable>
          );
        })}
      </View>
      <Text style={s.rodape}>Você pode trocar de perfil a qualquer momento pelo botão “Início”.</Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  conteudo: { flexGrow: 1, backgroundColor: cores.fundo, paddingHorizontal: 20, gap: 28, alignItems: 'stretch' },
  pergunta: { color: cores.texto, fontSize: 20, fontWeight: '700', textAlign: 'center' },
  grade: { gap: 14 },
  cartao: { flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 16, borderLeftWidth: 5, paddingVertical: 20, paddingHorizontal: 18 },
  divisor: { width: 1, alignSelf: 'stretch', backgroundColor: 'rgba(255,255,255,0.35)' },
  titulo: { color: '#FFFFFF', fontSize: 19, fontWeight: '800', letterSpacing: 0.5 },
  sub: { color: 'rgba(255,255,255,0.82)', fontSize: 14, marginTop: 2 },
  rodape: { color: cores.apagado, fontSize: 12, textAlign: 'center' },
});
