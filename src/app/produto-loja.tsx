import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import EscolherFoto from '../components/EscolherFoto';
import { cores, raio } from '../components/tema';
import { enviarFoto, ErroApi } from '../services/api';
import * as D from '../services/delivery';

const numero = (t: string) => Number(t.replace(/\./g, '').replace(',', '.'));

/** Cadastro e edição de um produto da vitrine (foto, nome, descrição, preço, seção, ativo). */
export default function ProdutoLoja() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [atual, setAtual] = useState<D.Produto | null>(null);
  const [secoes, setSecoes] = useState<string[]>([]);
  const [f, setF] = useState({ nome: '', descricao: '', preco: '', categoria: '', ativo: true });
  const [foto, setFoto] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(!!id);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    D.meusProdutos()
      .then((lista) => {
        setSecoes([...new Set(lista.map((p) => p.categoria).filter(Boolean))]);
        const p = id ? lista.find((x) => x.id === id) : undefined;
        if (p) {
          setAtual(p);
          setF({ nome: p.nome, descricao: p.descricao, preco: String(p.preco.toFixed(2)).replace('.', ','), categoria: p.categoria, ativo: p.ativo });
        }
      })
      .catch(() => {})
      .finally(() => setCarregando(false));
  }, [id]);

  if (carregando) return <ActivityIndicator style={{ marginTop: 60 }} color={cores.primaria} />;
  const ok = f.nome.trim().length >= 2 && numero(f.preco) >= 0.5;

  async function salvar() {
    setSalvando(true);
    try {
      const chave = foto ? (await enviarFoto('lojista', 'produto', foto)).chave : undefined;
      await D.salvarProduto({ id: atual?.id, nome: f.nome, descricao: f.descricao, preco: numero(f.preco), categoria: f.categoria, ativo: f.ativo, ...(chave ? { foto: chave } : {}) });
      router.back();
    } catch (e) {
      Alert.alert('Produto', e instanceof ErroApi ? e.message : 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  }
  function apagar() {
    if (!atual) return;
    Alert.alert('Excluir produto?', `${atual.nome} sai da vitrine. Para tirar só por um tempo, desligue "Disponível".`, [
      { text: 'Voltar', style: 'cancel' },
      {
        text: 'Excluir',
        style: 'destructive',
        onPress: () =>
          D.apagarProduto(atual.id)
            .then(() => router.back())
            .catch((e) => Alert.alert('Produto', (e as Error).message)),
      },
    ]);
  }

  return (
    <ScrollView contentContainerStyle={s.conteudo} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: atual ? 'Editar produto' : 'Novo produto' }} />
      <EscolherFoto uri={foto ?? (atual?.temFoto ? D.fotoProduto(atual) : null)} onEscolher={setFoto} rotulo="Foto do produto (opcional)" />
      <Text style={s.rotulo}>Nome</Text>
      <TextInput style={s.input} value={f.nome} onChangeText={(t) => setF({ ...f, nome: t })} placeholder="Ex.: X-Burguer" placeholderTextColor={cores.apagado} maxLength={80} />
      <Text style={s.rotulo}>Descrição (opcional)</Text>
      <TextInput
        style={[s.input, { minHeight: 70, textAlignVertical: 'top' }]}
        value={f.descricao}
        onChangeText={(t) => setF({ ...f, descricao: t })}
        placeholder="Ex.: pão, carne 150 g, queijo e salada"
        placeholderTextColor={cores.apagado}
        maxLength={300}
        multiline
      />
      <Text style={s.rotulo}>Preço (R$)</Text>
      <TextInput style={s.input} value={f.preco} onChangeText={(t) => setF({ ...f, preco: t })} placeholder="0,00" placeholderTextColor={cores.apagado} keyboardType="decimal-pad" />
      <Text style={s.rotulo}>Seção da vitrine</Text>
      <TextInput style={s.input} value={f.categoria} onChangeText={(t) => setF({ ...f, categoria: t })} placeholder="Ex.: Lanches, Bebidas, Hortifrúti" placeholderTextColor={cores.apagado} maxLength={40} />
      {secoes.length > 0 && (
        <View style={s.chips}>
          {secoes.map((c) => (
            <Pressable key={c} style={[s.chip, f.categoria === c && s.chipAtivo]} onPress={() => setF({ ...f, categoria: c })}>
              <Text style={[s.chipTexto, f.categoria === c && { color: cores.primaria }]}>{c}</Text>
            </Pressable>
          ))}
        </View>
      )}
      <View style={s.linha}>
        <View style={{ flex: 1 }}>
          <Text style={s.item}>Disponível</Text>
          <Text style={s.sub}>Desligue quando acabar o estoque.</Text>
        </View>
        <Switch value={f.ativo} onValueChange={(ativo) => setF({ ...f, ativo })} trackColor={{ true: cores.primaria }} />
      </View>
      <Pressable style={[s.botao, (!ok || salvando) && { opacity: 0.45 }]} disabled={!ok || salvando} onPress={salvar}>
        {salvando ? <ActivityIndicator color="#fff" /> : <Text style={s.botaoTexto}>Salvar produto</Text>}
      </Pressable>
      {atual && (
        <Pressable onPress={apagar}>
          <Text style={s.excluir}>Excluir produto</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  conteudo: { padding: 20, gap: 8, paddingBottom: 40 },
  rotulo: { fontSize: 13, color: cores.suave, marginTop: 8 },
  input: { backgroundColor: cores.cartao, borderRadius: 12, borderWidth: 1, borderColor: cores.borda, paddingHorizontal: 12, paddingVertical: 12, fontSize: 16, color: cores.texto },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18, borderWidth: 1, borderColor: cores.borda },
  chipAtivo: { borderColor: cores.primaria, backgroundColor: cores.primariaClara },
  chipTexto: { color: cores.texto, fontSize: 13, fontWeight: '600' },
  linha: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: cores.cartao, borderRadius: raio, padding: 14, marginTop: 10, borderWidth: 1, borderColor: cores.borda },
  item: { fontSize: 15, fontWeight: '700', color: cores.texto },
  sub: { fontSize: 13, color: cores.suave },
  botao: { backgroundColor: cores.primaria, borderRadius: raio, paddingVertical: 16, alignItems: 'center', marginTop: 14 },
  botaoTexto: { color: '#fff', fontSize: 17, fontWeight: '700' },
  excluir: { color: cores.erro, fontWeight: '700', textAlign: 'center', padding: 12 },
});
