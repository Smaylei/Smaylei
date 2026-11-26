import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import EscolherFoto from '../components/EscolherFoto';
import { cores, raio } from '../components/tema';
import { CATEGORIAS_LOJA, type CategoriaLoja } from '../data/servicos';
import { enviarFoto, ErroApi } from '../services/api';
import * as D from '../services/delivery';
import { formatarReais } from '../services/preco';

const data = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const numero = (t: string) => Number(t.replace(/\./g, '').replace(',', '.'));
const br = (n: number) => String(n).replace('.', ',');

/** Vitrine do lojista no Delivery: mensalidade, loja aberta/fechada, dados da loja e produtos. */
export default function Vitrine() {
  const [v, setV] = useState<D.MinhaVitrine | null>(null);
  const [produtos, setProdutos] = useState<D.Produto[]>([]);
  const [form, setForm] = useState({ descricao: '', categoria: 'mercado' as CategoriaLoja, minimo: '', preparo: '', pix: '' });
  const [logo, setLogo] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [agora, setAgora] = useState(0);

  const carregar = useCallback(async () => {
    try {
      const [x, ps] = await Promise.all([D.minhaVitrine(), D.meusProdutos()]);
      setV(x);
      setAgora(Date.now());
      setProdutos(ps);
      setForm({ descricao: x.descricao, categoria: x.categoria, minimo: x.pedidoMinimo ? br(x.pedidoMinimo) : '', preparo: String(x.preparoMin), pix: x.pix ?? '' });
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      const t = setTimeout(carregar, 0);
      return () => clearTimeout(t);
    }, [carregar]),
  );

  if (!v) return erro ? <Text style={[s.erro, { padding: 20 }]}>{erro}</Text> : <ActivityIndicator style={{ marginTop: 60 }} color={cores.primaria} />;
  const vence = v.ativaAte ? Math.ceil((Date.parse(v.ativaAte) - agora) / 86400000) : 0;

  async function ativar() {
    try {
      const m = await D.pagarMensalidade();
      router.push({ pathname: '/checkout/[id]', params: { id: m.id, tipo: 'mensalidade' } });
    } catch (e) {
      Alert.alert('Vitrine', e instanceof ErroApi ? e.message : 'Tente de novo.');
    }
  }
  async function abrirFechar(aberta: boolean) {
    setV({ ...v!, aberta });
    await D.salvarVitrine({ aberta }).catch((e) => {
      setV({ ...v!, aberta: !aberta });
      Alert.alert('Vitrine', (e as Error).message);
    });
  }
  async function salvar() {
    setSalvando(true);
    try {
      if (logo) {
        await enviarFoto('lojista', 'foto', logo);
        setLogo(null);
      }
      await D.salvarVitrine({ descricao: form.descricao, categoria: form.categoria, pedidoMinimo: numero(form.minimo || '0'), preparoMin: numero(form.preparo), pix: form.pix });
      await carregar();
      Alert.alert('Vitrine', 'Dados salvos.');
    } catch (e) {
      Alert.alert('Vitrine', e instanceof ErroApi ? e.message : 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={s.conteudo} refreshControl={<RefreshControl refreshing={false} onRefresh={carregar} tintColor={cores.primaria} />} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: 'Minha vitrine' }} />
      {!v.liberado && <Text style={s.aviso}>🚀 O Delivery da MOVI será liberado em breve. Já cadastre seus produtos para começar a vender assim que abrir.</Text>}
      {!v.aprovada && <Text style={s.aviso}>⏳ O cadastro da loja está em análise. Você já pode montar a vitrine.</Text>}

      <View style={[s.cartao, v.ativa ? s.cartaoOk : null]}>
        <Text style={s.cartaoTitulo}>{v.ativa ? '✅ Vitrine ativa' : 'Venda pelo app da MOVI'}</Text>
        <Text style={s.texto}>
          {v.ativa && v.ativaAte
            ? `Ativa até ${data(v.ativaAte)}${vence <= 7 ? ` · vence em ${vence} ${vence === 1 ? 'dia' : 'dias'}` : ''}.`
            : `${formatarReais(v.mensalidade)} a cada ${v.diasMensalidade} dias. Sem taxa por pedido: 100% das vendas são da loja. A MOVI faz a entrega (o frete é pago pelo cliente).`}
        </Text>
        <Pressable style={[s.botao, (!v.liberado || !v.aprovada) && { opacity: 0.45 }]} disabled={!v.liberado || !v.aprovada} onPress={ativar}>
          <Text style={s.botaoTexto}>{v.ativa ? `Renovar +${v.diasMensalidade} dias · ${formatarReais(v.mensalidade)}` : `Ativar vitrine · ${formatarReais(v.mensalidade)}`}</Text>
        </Pressable>
      </View>

      <View style={s.linhaSwitch}>
        <View style={{ flex: 1 }}>
          <Text style={s.item}>Loja aberta para pedidos</Text>
          <Text style={s.sub}>{v.aberta ? 'Os clientes podem pedir agora.' : 'Fechada: a vitrine aparece, mas não recebe pedidos.'}</Text>
        </View>
        <Switch value={v.aberta} onValueChange={abrirFechar} disabled={!v.aprovada} trackColor={{ true: cores.primaria }} />
      </View>

      <View style={s.atalhos}>
        <Pressable style={[s.atalho, v.pedidosNovos > 0 && s.atalhoNovo]} onPress={() => router.push('/pedidos-loja')}>
          <Text style={s.atalhoNum}>{v.pedidosNovos > 0 ? v.pedidosNovos : v.pedidosAndamento}</Text>
          <Text style={s.atalhoTexto}>{v.pedidosNovos > 0 ? 'pedidos novos' : 'pedidos em andamento'}</Text>
        </Pressable>
        <Pressable style={s.atalho} onPress={() => router.push({ pathname: '/pedidos-loja', params: { aba: 'vendas' } })}>
          <Text style={s.atalhoNum}>{formatarReais(v.saldo.disponivel)}</Text>
          <Text style={s.atalhoTexto}>a receber</Text>
        </Pressable>
      </View>

      <Text style={s.secao}>Dados da vitrine</Text>
      <View style={s.cartao}>
        <EscolherFoto uri={logo ?? (v.temFoto ? D.fotoLoja(v) : null)} onEscolher={setLogo} rotulo="Logo da loja" tamanho={72} icone="🏪" />
        <Text style={s.rotulo}>Tipo de loja</Text>
        <View style={s.chips}>
          {CATEGORIAS_LOJA.map((c) => (
            <Pressable key={c.id} style={[s.chip, form.categoria === c.id && s.chipAtivo]} onPress={() => setForm({ ...form, categoria: c.id })}>
              <Text style={[s.chipTexto, form.categoria === c.id && { color: cores.primaria }]}>
                {c.icone} {c.nome}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={s.rotulo}>Descrição curta</Text>
        <TextInput style={s.input} value={form.descricao} onChangeText={(t) => setForm({ ...form, descricao: t })} placeholder="Ex.: Lanches na chapa e porções" placeholderTextColor={cores.apagado} maxLength={200} />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Text style={s.rotulo}>Pedido mínimo (R$)</Text>
            <TextInput style={s.input} value={form.minimo} onChangeText={(t) => setForm({ ...form, minimo: t })} placeholder="0,00" placeholderTextColor={cores.apagado} keyboardType="decimal-pad" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.rotulo}>Preparo (min)</Text>
            <TextInput style={s.input} value={form.preparo} onChangeText={(t) => setForm({ ...form, preparo: t })} keyboardType="number-pad" maxLength={3} />
          </View>
        </View>
        <Text style={s.rotulo}>Chave Pix para receber as vendas</Text>
        <TextInput style={s.input} value={form.pix} onChangeText={(t) => setForm({ ...form, pix: t })} placeholder="CNPJ, e-mail, celular ou chave aleatória" placeholderTextColor={cores.apagado} autoCapitalize="none" />
        <Pressable style={[s.botao, salvando && { opacity: 0.5 }]} disabled={salvando} onPress={salvar}>
          {salvando ? <ActivityIndicator color="#fff" /> : <Text style={s.botaoTexto}>Salvar dados</Text>}
        </Pressable>
      </View>

      <View style={s.linhaTitulo}>
        <Text style={s.secao}>Produtos ({produtos.length})</Text>
        <Pressable onPress={() => router.push('/produto-loja')} hitSlop={8}>
          <Text style={s.link}>+ Novo produto</Text>
        </Pressable>
      </View>
      {!produtos.length && <Text style={s.sub}>Cadastre os produtos com foto, preço e a seção (ex.: Lanches, Bebidas). Só os produtos ativos aparecem para os clientes.</Text>}
      {produtos.map((p) => (
        <Pressable key={p.id} style={[s.produto, !p.ativo && { opacity: 0.5 }]} onPress={() => router.push({ pathname: '/produto-loja', params: { id: p.id } })}>
          <View style={s.foto}>{p.temFoto ? <Image source={{ uri: D.fotoProduto(p) }} style={StyleSheet.absoluteFill} /> : <Text style={{ fontSize: 22 }}>📦</Text>}</View>
          <View style={{ flex: 1 }}>
            <Text style={s.item}>{p.nome}</Text>
            <Text style={s.sub}>
              {p.categoria || 'Sem seção'} · {formatarReais(p.preco)}
              {p.ativo ? '' : ' · pausado'}
            </Text>
          </View>
          <Text style={s.link}>Editar</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  conteudo: { padding: 20, gap: 12, paddingBottom: 40 },
  erro: { color: cores.erro, fontSize: 14 },
  aviso: { backgroundColor: cores.alertaFundo, color: cores.alerta, borderRadius: raio, padding: 12, fontSize: 13, lineHeight: 19 },
  cartao: { backgroundColor: cores.cartao, borderRadius: raio + 2, padding: 16, gap: 10, borderWidth: 1, borderColor: cores.borda },
  cartaoOk: { borderColor: cores.primariaMedia },
  cartaoTitulo: { fontSize: 18, fontWeight: '700', color: cores.texto },
  texto: { fontSize: 14, color: cores.suave, lineHeight: 20 },
  botao: { backgroundColor: cores.primaria, borderRadius: raio, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  botaoTexto: { color: '#fff', fontSize: 16, fontWeight: '700' },
  linhaSwitch: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: cores.cartao, borderRadius: raio, padding: 14, borderWidth: 1, borderColor: cores.borda },
  item: { fontSize: 15, fontWeight: '700', color: cores.texto },
  sub: { fontSize: 13, color: cores.suave, lineHeight: 18 },
  atalhos: { flexDirection: 'row', gap: 10 },
  atalho: { flex: 1, backgroundColor: cores.cartao, borderRadius: raio, padding: 14, borderWidth: 1, borderColor: cores.borda, gap: 2 },
  atalhoNovo: { borderColor: cores.primaria, backgroundColor: cores.primariaClara },
  atalhoNum: { fontSize: 20, fontWeight: '800', color: cores.texto },
  atalhoTexto: { fontSize: 13, color: cores.suave },
  secao: { fontSize: 13, fontWeight: '800', color: cores.primaria, letterSpacing: 1, textTransform: 'uppercase', marginTop: 8 },
  rotulo: { fontSize: 13, color: cores.suave, marginTop: 4 },
  input: { backgroundColor: cores.fundo, borderRadius: 12, borderWidth: 1, borderColor: cores.borda, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, color: cores.texto },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18, borderWidth: 1, borderColor: cores.borda },
  chipAtivo: { borderColor: cores.primaria, backgroundColor: cores.primariaClara },
  chipTexto: { color: cores.texto, fontSize: 13, fontWeight: '600' },
  linhaTitulo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  link: { color: cores.primaria, fontWeight: '700', fontSize: 14 },
  produto: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: cores.cartao, borderRadius: raio, padding: 12, borderWidth: 1, borderColor: cores.borda },
  foto: { width: 52, height: 52, borderRadius: 12, backgroundColor: cores.cartaoAlto, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
