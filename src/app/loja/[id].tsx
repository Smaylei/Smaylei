import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { cores, raio } from '../../components/tema';
import { categoriaLoja } from '../../data/servicos';
import { alterarItem, esvaziar, outraLoja, qtdItens, subtotal, useCarrinho } from '../../estado/carrinho';
import * as D from '../../services/delivery';
import { formatarReais } from '../../services/preco';

/** Vitrine de uma loja: produtos por seção, com quantidade, e o carrinho no rodapé. */
export default function Loja() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [dados, setDados] = useState<{ loja: D.LojaVitrine; produtos: D.Produto[] } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const carrinho = useCarrinho();

  useFocusEffect(
    useCallback(() => {
      const t = setTimeout(() => {
        D.vitrine(id)
          .then(setDados)
          .catch((e) => setErro((e as Error).message));
      }, 0);
      return () => clearTimeout(t);
    }, [id]),
  );

  if (!dados) return erro ? <Text style={[s.erro, { padding: 20 }]}>{erro}</Text> : <ActivityIndicator style={{ marginTop: 60 }} color={cores.primaria} />;
  const { loja, produtos } = dados;
  const secoes = [...new Set(produtos.map((p) => p.categoria || 'Produtos'))];
  const qtd = (pid: string) => (carrinho.lojaId === loja.id ? (carrinho.itens.find((i) => i.produto.id === pid)?.qtd ?? 0) : 0);

  function mudar(p: D.Produto, delta: number) {
    if (delta > 0 && outraLoja(loja.id)) {
      Alert.alert('Trocar de loja?', `Seu carrinho tem produtos de ${carrinho.lojaNome}. Cada pedido é de uma loja só.`, [
        { text: 'Manter', style: 'cancel' },
        {
          text: 'Esvaziar e trocar',
          style: 'destructive',
          onPress: () => {
            esvaziar();
            alterarItem(loja, p, delta);
          },
        },
      ]);
      return;
    }
    alterarItem(loja, p, delta);
  }

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: loja.nome }} />
      <ScrollView contentContainerStyle={s.conteudo}>
        <View style={s.cabeca}>
          <View style={s.logo}>{loja.temFoto ? <Image source={{ uri: D.fotoLoja(loja) }} style={StyleSheet.absoluteFill} /> : <Text style={{ fontSize: 30 }}>{categoriaLoja(loja.categoria).icone}</Text>}</View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={s.nome}>{loja.nome}</Text>
            <Text style={s.sub}>{categoriaLoja(loja.categoria).nome}</Text>
            <Text style={[s.estado, { color: loja.aberta ? cores.sucesso : cores.erro }]}>
              {loja.aberta ? `Aberta · preparo ~${loja.preparoMin} min` : 'Fechada agora'}
              {loja.pedidoMinimo > 0 ? ` · mínimo ${formatarReais(loja.pedidoMinimo)}` : ''}
            </Text>
          </View>
        </View>
        {!!loja.descricao && <Text style={s.desc}>{loja.descricao}</Text>}

        {secoes.map((sec) => (
          <View key={sec} style={{ gap: 8 }}>
            <Text style={s.secao}>{sec}</Text>
            {produtos
              .filter((p) => (p.categoria || 'Produtos') === sec)
              .map((p) => {
                const n = qtd(p.id);
                return (
                  <View key={p.id} style={s.produto}>
                    {p.temFoto && <Image source={{ uri: D.fotoProduto(p) }} style={s.foto} />}
                    <View style={{ flex: 1, gap: 3 }}>
                      <Text style={s.prodNome}>{p.nome}</Text>
                      {!!p.descricao && (
                        <Text style={s.prodDesc} numberOfLines={3}>
                          {p.descricao}
                        </Text>
                      )}
                      <Text style={s.preco}>{formatarReais(p.preco)}</Text>
                    </View>
                    {n > 0 ? (
                      <View style={s.passo}>
                        <Pressable style={s.passoBotao} onPress={() => mudar(p, -1)} hitSlop={6}>
                          <Text style={s.passoTexto}>−</Text>
                        </Pressable>
                        <Text style={s.qtd}>{n}</Text>
                        <Pressable style={s.passoBotao} onPress={() => mudar(p, 1)} hitSlop={6}>
                          <Text style={s.passoTexto}>+</Text>
                        </Pressable>
                      </View>
                    ) : (
                      <Pressable style={[s.add, !loja.aberta && { opacity: 0.4 }]} disabled={!loja.aberta} onPress={() => mudar(p, 1)}>
                        <Text style={s.addTexto}>Adicionar</Text>
                      </Pressable>
                    )}
                  </View>
                );
              })}
          </View>
        ))}
      </ScrollView>
      {carrinho.lojaId === loja.id && carrinho.itens.length > 0 && (
        <Pressable style={s.barra} onPress={() => router.push('/carrinho')}>
          <Text style={s.barraTexto}>
            Ver carrinho · {qtdItens(carrinho)} {qtdItens(carrinho) === 1 ? 'item' : 'itens'}
          </Text>
          <Text style={s.barraValor}>{formatarReais(subtotal(carrinho))} ›</Text>
        </Pressable>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  conteudo: { padding: 20, gap: 14, paddingBottom: 110 },
  erro: { color: cores.erro, fontSize: 14 },
  cabeca: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  logo: { width: 76, height: 76, borderRadius: 20, backgroundColor: cores.cartaoAlto, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  nome: { fontSize: 22, fontWeight: '700', color: cores.texto },
  sub: { fontSize: 13, color: cores.suave },
  estado: { fontSize: 13, fontWeight: '700' },
  desc: { fontSize: 14, color: cores.suave, lineHeight: 20 },
  secao: { fontSize: 13, fontWeight: '800', color: cores.primaria, letterSpacing: 1, textTransform: 'uppercase', marginTop: 8 },
  produto: { flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: cores.cartao, borderRadius: raio, padding: 12, borderWidth: 1, borderColor: cores.borda },
  foto: { width: 72, height: 72, borderRadius: 12, backgroundColor: cores.cartaoAlto },
  prodNome: { fontSize: 16, fontWeight: '700', color: cores.texto },
  prodDesc: { fontSize: 13, color: cores.suave, lineHeight: 18 },
  preco: { fontSize: 15, fontWeight: '700', color: cores.texto, marginTop: 2 },
  add: { borderWidth: 1.5, borderColor: cores.primaria, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12 },
  addTexto: { color: cores.primaria, fontWeight: '700', fontSize: 13 },
  passo: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: cores.primariaClara, borderRadius: 12, paddingHorizontal: 6, paddingVertical: 4 },
  passoBotao: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  passoTexto: { color: cores.primaria, fontSize: 22, fontWeight: '700', lineHeight: 24 },
  qtd: { color: cores.texto, fontSize: 16, fontWeight: '700', minWidth: 18, textAlign: 'center' },
  barra: {
    position: 'absolute', left: 16, right: 16, bottom: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: cores.primaria, borderRadius: raio, paddingVertical: 16, paddingHorizontal: 18,
  },
  barraTexto: { color: '#fff', fontWeight: '700', fontSize: 15 },
  barraValor: { color: '#fff', fontWeight: '800', fontSize: 16 },
});
