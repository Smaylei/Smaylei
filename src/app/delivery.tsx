import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { cores, raio } from '../components/tema';
import { CATEGORIAS_LOJA, categoriaLoja, type CategoriaLoja } from '../data/servicos';
import { qtdItens, subtotal, useCarrinho } from '../estado/carrinho';
import * as D from '../services/delivery';
import { formatarReais } from '../services/preco';

/** Delivery: lojas da cidade com vitrine na MOVI. O cliente escolhe a loja e monta o pedido. */
export default function Delivery() {
  const [dados, setDados] = useState<{ lojas: D.LojaVitrine[]; entrega: D.Entrega } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<CategoriaLoja | null>(null);
  const carrinho = useCarrinho();

  const carregar = useCallback(() => {
    D.lojas()
      .then((d) => {
        setDados(d);
        setErro(null);
      })
      .catch((e) => setErro((e as Error).message));
  }, []);
  useFocusEffect(
    useCallback(() => {
      const t = setTimeout(carregar, 0);
      return () => clearTimeout(t);
    }, [carregar]),
  );

  const presentes = CATEGORIAS_LOJA.filter((c) => dados?.lojas.some((l) => l.categoria === c.id));
  const lista = (dados?.lojas ?? []).filter((l) => !filtro || l.categoria === filtro);

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: 'Delivery' }} />
      <ScrollView contentContainerStyle={s.conteudo} refreshControl={<RefreshControl refreshing={false} onRefresh={carregar} tintColor={cores.primaria} />}>
        <Text style={s.titulo}>Peça das lojas da cidade</Text>
        <Text style={s.sub}>Escolha os produtos, pague no app (Pix ou cartão à vista) e a MOVI entrega na sua casa.</Text>
        {dados && !dados.entrega.ok && <Text style={s.aviso}>⏳ {dados.entrega.motivo ?? 'Entregas indisponíveis agora.'} Você pode ver as vitrines, mas o pedido fica para depois.</Text>}
        {erro && <Text style={s.erro}>{erro}</Text>}
        {!dados && !erro && <ActivityIndicator style={{ marginTop: 40 }} color={cores.primaria} />}

        {presentes.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            <Pressable style={[s.chip, !filtro && s.chipAtivo]} onPress={() => setFiltro(null)}>
              <Text style={[s.chipTexto, !filtro && s.chipTextoAtivo]}>Todas</Text>
            </Pressable>
            {presentes.map((c) => (
              <Pressable key={c.id} style={[s.chip, filtro === c.id && s.chipAtivo]} onPress={() => setFiltro(c.id)}>
                <Text style={[s.chipTexto, filtro === c.id && s.chipTextoAtivo]}>
                  {c.icone} {c.nome}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        )}

        {dados && !lista.length && (
          <View style={s.vazio}>
            <Text style={{ fontSize: 34 }}>🛵</Text>
            <Text style={s.vazioTexto}>Ainda não há lojas no delivery da sua região. Em breve!</Text>
          </View>
        )}
        {lista.map((l) => {
          const cat = categoriaLoja(l.categoria);
          return (
            <Pressable key={l.id} style={[s.loja, !l.aberta && { opacity: 0.55 }]} onPress={() => router.push(`/loja/${l.id}`)}>
              <View style={s.logo}>{l.temFoto ? <Image source={{ uri: D.fotoLoja(l) }} style={StyleSheet.absoluteFill} /> : <Text style={{ fontSize: 26 }}>{cat.icone}</Text>}</View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={s.lojaNome} numberOfLines={1}>
                  {l.nome}
                </Text>
                <Text style={s.lojaSub} numberOfLines={1}>
                  {cat.nome}
                  {l.distanciaKm != null ? ` · ${String(l.distanciaKm).replace('.', ',')} km` : ''}
                </Text>
                {!!l.descricao && (
                  <Text style={s.lojaDesc} numberOfLines={2}>
                    {l.descricao}
                  </Text>
                )}
                <Text style={[s.lojaEstado, { color: l.aberta ? cores.sucesso : cores.apagado }]}>
                  {l.aberta ? `Aberta · preparo ~${l.preparoMin} min` : 'Fechada agora'}
                  {l.pedidoMinimo > 0 ? ` · mínimo ${formatarReais(l.pedidoMinimo)}` : ''}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
      {carrinho.itens.length > 0 && (
        <Pressable style={s.barra} onPress={() => router.push('/carrinho')}>
          <Text style={s.barraTexto}>
            🛒 {carrinho.lojaNome} · {qtdItens(carrinho)} {qtdItens(carrinho) === 1 ? 'item' : 'itens'}
          </Text>
          <Text style={s.barraValor}>{formatarReais(subtotal(carrinho))} ›</Text>
        </Pressable>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  conteudo: { padding: 20, gap: 12, paddingBottom: 110 },
  titulo: { fontSize: 22, fontWeight: '700', color: cores.texto },
  sub: { fontSize: 14, color: cores.suave, lineHeight: 20 },
  aviso: { backgroundColor: cores.alertaFundo, color: cores.alerta, borderRadius: raio, padding: 12, fontSize: 13, lineHeight: 19 },
  erro: { color: cores.erro, fontSize: 14 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: cores.borda, backgroundColor: cores.cartao },
  chipAtivo: { borderColor: cores.primaria, backgroundColor: cores.primariaClara },
  chipTexto: { color: cores.texto, fontWeight: '600', fontSize: 13 },
  chipTextoAtivo: { color: cores.primaria },
  vazio: { alignItems: 'center', gap: 8, padding: 30 },
  vazioTexto: { color: cores.suave, textAlign: 'center', fontSize: 14 },
  loja: { flexDirection: 'row', gap: 14, alignItems: 'center', backgroundColor: cores.cartao, borderRadius: raio + 2, padding: 14, borderWidth: 1, borderColor: cores.borda },
  logo: { width: 64, height: 64, borderRadius: 16, backgroundColor: cores.cartaoAlto, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  lojaNome: { fontSize: 17, fontWeight: '700', color: cores.texto },
  lojaSub: { fontSize: 13, color: cores.suave },
  lojaDesc: { fontSize: 13, color: cores.texto, opacity: 0.85, lineHeight: 18 },
  lojaEstado: { fontSize: 12, fontWeight: '700', marginTop: 2 },
  barra: {
    position: 'absolute', left: 16, right: 16, bottom: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: cores.primaria, borderRadius: raio, paddingVertical: 16, paddingHorizontal: 18,
  },
  barraTexto: { color: '#fff', fontWeight: '700', fontSize: 15, flex: 1 },
  barraValor: { color: '#fff', fontWeight: '800', fontSize: 16 },
});
