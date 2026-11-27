import * as Clipboard from 'expo-clipboard';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { cores, raio } from '../components/tema';
import { useApp } from '../estado/AppContext';
import { api, ErroApi, type CorridaCliente, type Gorjeta } from '../services/api';
import * as D from '../services/delivery';
import * as P from '../services/pagamento';
import { formatarReais } from '../services/preco';
import { SOLICITANTE } from '../variante';

type Resumo = { titulo: string; valor: number; pendente: boolean; prazo: string | null };

async function resumo(tipo: P.TipoPagamento, id: string): Promise<Resumo> {
  if (tipo === 'corrida') {
    const c = await api<CorridaCliente>(SOLICITANTE, `/v2/corridas/${id}`);
    const pendente = c.status === 'pagamento_pendente' || !!c.aguardandoPagamento;
    return { titulo: c.pacote ? `${c.servicoTitulo} · ${c.pacote.viagens} viagens` : (c.servicoTitulo ?? 'Frete'), valor: c.pacote?.valor ?? c.valor, pendente, prazo: c.pagamentoAte ?? null };
  }
  if (tipo === 'pedido') {
    const p = await D.pedido(id);
    return { titulo: `Pedido #${p.codigo} · ${p.loja.nome}`, valor: p.total, pendente: p.status === 'pagamento_pendente', prazo: p.pagamentoAte };
  }
  if (tipo === 'mensalidade') {
    const m = await D.mensalidade(id);
    return { titulo: 'Vitrine MOVI Delivery · 30 dias', valor: m.valor, pendente: m.status === 'pendente', prazo: null };
  }
  const g = await api<Gorjeta>(SOLICITANTE, `/v2/gorjetas/${id}`);
  return { titulo: 'Gorjeta para o motorista', valor: g.valor, pendente: g.status === 'pendente', prazo: null };
}

/** Pagamento dentro do app (Pagar.me): Pix com QR Code e copia e cola, ou cartão à vista. */
export default function Pagar() {
  const { tipo, id } = useLocalSearchParams<{ tipo: P.TipoPagamento; id: string }>();
  const { config } = useApp();
  const [r, setR] = useState<Resumo | null>(null);
  const [metodo, setMetodo] = useState<'pix' | 'cartao'>('pix');
  const [cob, setCob] = useState<P.Cobranca | null>(null);
  const [cartao, setCartao] = useState({ numero: '', nome: '', validade: '', cvv: '', cep: '' });
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const saiu = useRef(false);

  const concluir = useCallback(() => {
    if (saiu.current) return;
    saiu.current = true;
    if (tipo === 'corrida') router.replace(`/corrida/${id}`);
    else if (tipo === 'pedido') router.replace(`/meu-pedido/${id}`);
    else if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [tipo, id]);

  useEffect(() => {
    resumo(tipo, id)
      .then((x) => {
        setR(x);
        if (!x.pendente) concluir();
      })
      .catch((e) => setMsg((e as Error).message));
  }, [tipo, id, concluir]);

  // Pix gerado: confere a cada 4 s até a Pagar.me confirmar.
  useEffect(() => {
    if (!cob || cob.status !== 'pendente' || cob.metodo !== 'pix') return;
    const t = setInterval(() => {
      P.cobranca(cob.id)
        .then((c) => {
          setCob(c);
          if (c.status === 'paga') concluir();
        })
        .catch(() => {});
    }, 4000);
    return () => clearInterval(t);
  }, [cob, concluir]);

  async function gerarPix() {
    setOcupado(true);
    setMsg(null);
    try {
      const c = await P.pagar(tipo, id, 'pix');
      setCob(c);
      if (c.status === 'paga') concluir();
    } catch (e) {
      setMsg(e instanceof ErroApi ? e.message : 'Não foi possível gerar o Pix.');
    } finally {
      setOcupado(false);
    }
  }
  async function pagarCartao() {
    const [mes, ano] = cartao.validade.split('/').map((x) => x.trim());
    if (cartao.numero.replace(/\D/g, '').length < 13 || !mes || !ano || cartao.cvv.length < 3 || cartao.nome.trim().length < 3 || cartao.cep.replace(/\D/g, '').length !== 8) {
      setMsg('Confira os dados do cartão e o CEP.');
      return;
    }
    if (!config.pagarmeChavePublica) {
      setMsg('Pagamento com cartão indisponível agora. Use o Pix.');
      return;
    }
    setOcupado(true);
    setMsg(null);
    try {
      const token = await P.tokenizarCartao(config.pagarmeChavePublica, { numero: cartao.numero, nome: cartao.nome, mes, ano, cvv: cartao.cvv });
      const c = await P.pagar(tipo, id, 'cartao', { cardToken: token, cep: cartao.cep });
      setCob(c);
      if (c.status === 'paga') concluir();
      else setMsg(c.erro ?? 'Pagamento não aprovado. Tente outro cartão ou o Pix.');
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }
  async function copiar() {
    if (!cob?.qrCode) return;
    await Clipboard.setStringAsync(cob.qrCode);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2500);
  }

  if (!r) return msg ? <Text style={[s.erro, { padding: 20 }]}>{msg}</Text> : <ActivityIndicator style={{ marginTop: 60 }} color={cores.primaria} />;
  const pixPronto = cob?.metodo === 'pix' && cob.status === 'pendente';

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.conteudo} keyboardShouldPersistTaps="handled">
        <Stack.Screen options={{ title: 'Pagamento' }} />
        <View style={s.topo}>
          <Text style={s.titulo}>{r.titulo}</Text>
          <Text style={s.valor}>{formatarReais(r.valor)}</Text>
          {r.prazo && <Text style={s.prazo}>Pague até {new Date(r.prazo).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</Text>}
        </View>

        <View style={s.abas}>
          {(['pix', 'cartao'] as const).map((m) => (
            <Pressable key={m} style={[s.aba, metodo === m && s.abaAtiva]} onPress={() => setMetodo(m)}>
              <Text style={[s.abaTexto, metodo === m && { color: '#fff' }]}>{m === 'pix' ? '⚡ Pix' : '💳 Cartão à vista'}</Text>
            </Pressable>
          ))}
        </View>

        {metodo === 'pix' &&
          (pixPronto ? (
            <View style={s.cartao}>
              {cob.qrCodeUrl && <Image source={{ uri: cob.qrCodeUrl }} style={s.qr} resizeMode="contain" />}
              <Text style={s.texto}>Abra o app do seu banco, escolha Pix → Ler QR Code, ou copie o código abaixo (Pix copia e cola).</Text>
              <Pressable style={s.botao} onPress={copiar}>
                <Text style={s.botaoTexto}>{copiado ? '✓ Código copiado' : 'Copiar código Pix'}</Text>
              </Pressable>
              <View style={s.aguardando}>
                <ActivityIndicator color={cores.primaria} />
                <Text style={s.suave}>Aguardando o pagamento… a confirmação é automática.</Text>
              </View>
            </View>
          ) : (
            <Pressable style={[s.botao, ocupado && { opacity: 0.5 }]} disabled={ocupado} onPress={gerarPix}>
              {ocupado ? <ActivityIndicator color="#fff" /> : <Text style={s.botaoTexto}>Gerar Pix de {formatarReais(r.valor)}</Text>}
            </Pressable>
          ))}

        {metodo === 'cartao' && (
          <View style={s.cartao}>
            <Text style={s.rotulo}>Número do cartão</Text>
            <TextInput style={s.input} value={cartao.numero} onChangeText={(t) => setCartao({ ...cartao, numero: t })} keyboardType="number-pad" placeholder="0000 0000 0000 0000" placeholderTextColor={cores.apagado} maxLength={23} autoComplete="cc-number" />
            <Text style={s.rotulo}>Nome impresso no cartão</Text>
            <TextInput style={s.input} value={cartao.nome} onChangeText={(t) => setCartao({ ...cartao, nome: t })} autoCapitalize="characters" placeholder="NOME SOBRENOME" placeholderTextColor={cores.apagado} maxLength={64} autoComplete="cc-name" />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={s.rotulo}>Validade</Text>
                <TextInput style={s.input} value={cartao.validade} onChangeText={(t) => setCartao({ ...cartao, validade: t })} placeholder="MM/AA" placeholderTextColor={cores.apagado} maxLength={7} keyboardType="numbers-and-punctuation" autoComplete="cc-exp" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.rotulo}>CVV</Text>
                <TextInput style={s.input} value={cartao.cvv} onChangeText={(t) => setCartao({ ...cartao, cvv: t })} keyboardType="number-pad" placeholder="123" placeholderTextColor={cores.apagado} maxLength={4} secureTextEntry autoComplete="cc-csc" />
              </View>
            </View>
            <Text style={s.rotulo}>CEP de cobrança</Text>
            <TextInput style={s.input} value={cartao.cep} onChangeText={(t) => setCartao({ ...cartao, cep: t })} keyboardType="number-pad" placeholder="89270-000" placeholderTextColor={cores.apagado} maxLength={9} autoComplete="postal-code" />
            <Pressable style={[s.botao, ocupado && { opacity: 0.5 }]} disabled={ocupado} onPress={pagarCartao}>
              {ocupado ? <ActivityIndicator color="#fff" /> : <Text style={s.botaoTexto}>Pagar {formatarReais(r.valor)} à vista</Text>}
            </Pressable>
            <Text style={s.suave}>Os dados do cartão vão direto para a Pagar.me; a MOVI não guarda o número do seu cartão. Sem parcelamento.</Text>
          </View>
        )}

        {msg && <Text style={s.erro}>{msg}</Text>}
        <Text style={s.info}>
          🔒 Pagamento processado pela Pagar.me (Stone).{' '}
          {tipo === 'pedido' ? 'Se a loja não aceitar, o valor volta automaticamente.' : tipo === 'corrida' ? 'Se a corrida for cancelada antes da chegada, o valor volta automaticamente.' : ''}
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  conteudo: { padding: 20, gap: 14, paddingBottom: 40 },
  topo: { backgroundColor: cores.primariaClara, borderRadius: raio, padding: 18, gap: 4, alignItems: 'center' },
  titulo: { fontSize: 15, color: cores.texto, fontWeight: '600', textAlign: 'center' },
  valor: { fontSize: 32, fontWeight: '800', color: cores.texto },
  prazo: { fontSize: 13, color: cores.alerta, fontWeight: '700' },
  abas: { flexDirection: 'row', gap: 8 },
  aba: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: cores.borda, backgroundColor: cores.cartao },
  abaAtiva: { backgroundColor: cores.primaria, borderColor: cores.primaria },
  abaTexto: { color: cores.texto, fontWeight: '700' },
  cartao: { backgroundColor: cores.cartao, borderRadius: raio + 2, padding: 16, gap: 10, borderWidth: 1, borderColor: cores.borda },
  qr: { width: 220, height: 220, alignSelf: 'center', backgroundColor: '#fff', borderRadius: 12 },
  texto: { fontSize: 14, color: cores.texto, lineHeight: 20, textAlign: 'center' },
  suave: { fontSize: 12, color: cores.suave, lineHeight: 18 },
  aguardando: { flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'center' },
  rotulo: { fontSize: 13, color: cores.suave },
  input: { backgroundColor: cores.fundo, borderRadius: 12, borderWidth: 1, borderColor: cores.borda, paddingHorizontal: 12, paddingVertical: 12, fontSize: 16, color: cores.texto },
  botao: { backgroundColor: cores.primaria, borderRadius: raio, paddingVertical: 16, alignItems: 'center' },
  botaoTexto: { color: '#fff', fontSize: 16, fontWeight: '700' },
  erro: { color: cores.erro, fontSize: 14 },
  info: { fontSize: 12, color: cores.suave, lineHeight: 18 },
});
