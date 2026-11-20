import { Redirect, router } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { cores, raio } from '../components/tema';
import { useApp } from '../estado/AppContext';

export default function Inicio() {
  const { carregado, casa } = useApp();

  if (!carregado) return <ActivityIndicator style={{ marginTop: 60 }} color={cores.primaria} />;
  if (!casa) return <Redirect href="/cadastro" />;

  return (
    <ScrollView contentContainerStyle={s.conteudo}>
      {/* Toque longo no título abre a administração das tarifas */}
      <Pressable onLongPress={() => router.push('/admin')} delayLongPress={1500}>
        <Text style={s.ola}>Olá{casa.nome && casa.nome !== 'Minha casa' ? `, ${casa.nome}` : ''}!</Text>
      </Pressable>
      <Text style={s.sub}>Suas compras do mercado entregues em casa.</Text>

      <Pressable style={[s.acao, s.acaoPrincipal]} onPress={() => router.push({ pathname: '/pedido', params: { modo: 'agora' } })}>
        <Text style={s.acaoIcone}>⚡</Text>
        <View style={{ flex: 1 }}>
          <Text style={[s.acaoTitulo, { color: '#fff' }]}>Solicitar frete</Text>
          <Text style={[s.acaoSub, { color: '#D7F0E1' }]}>Entrega agora, o quanto antes</Text>
        </View>
      </Pressable>

      <Pressable style={s.acao} onPress={() => router.push({ pathname: '/pedido', params: { modo: 'agendar' } })}>
        <Text style={s.acaoIcone}>📅</Text>
        <View style={{ flex: 1 }}>
          <Text style={s.acaoTitulo}>Agendar frete</Text>
          <Text style={s.acaoSub}>Escolha o dia e o horário</Text>
        </View>
      </Pressable>

      <View style={s.endereco}>
        <View style={{ flex: 1 }}>
          <Text style={s.rotulo}>Entregar em</Text>
          <Text style={s.enderecoTexto}>{casa.endereco}</Text>
        </View>
        <Pressable onPress={() => router.push('/cadastro')} hitSlop={10}>
          <Text style={s.alterar}>Alterar</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  conteudo: { padding: 20, gap: 14 },
  ola: { fontSize: 26, fontWeight: '800', color: cores.texto, marginTop: 8 },
  sub: { fontSize: 15, color: cores.suave, marginBottom: 8 },
  acao: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: cores.cartao,
    borderRadius: raio + 4,
    borderWidth: 1,
    borderColor: cores.borda,
    paddingVertical: 24,
    paddingHorizontal: 20,
  },
  acaoPrincipal: { backgroundColor: cores.primaria, borderColor: cores.primaria },
  acaoIcone: { fontSize: 32 },
  acaoTitulo: { fontSize: 21, fontWeight: '800', color: cores.texto },
  acaoSub: { fontSize: 14, color: cores.suave, marginTop: 2 },
  endereco: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 10,
    padding: 14,
    borderRadius: raio,
    backgroundColor: cores.primariaClara,
  },
  rotulo: { fontSize: 12, fontWeight: '700', color: cores.primaria, textTransform: 'uppercase', letterSpacing: 0.5 },
  enderecoTexto: { fontSize: 15, color: cores.texto, marginTop: 2 },
  alterar: { color: cores.primaria, fontWeight: '700', fontSize: 15 },
});
