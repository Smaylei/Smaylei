import * as Linking from 'expo-linking';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { cores, raio } from '../components/tema';
import { URL_RETORNO_PAGAMENTO } from '../config';
import { MERCADOS } from '../data/mercados';
import { useApp } from '../estado/AppContext';
import { criarLinkPagamento, lerRetorno, novoOrderNsu, verificarPagamento } from '../services/pagamento';
import { salvarPedido, type Pedido } from '../services/pedidos';
import { formatarReais } from '../services/preco';

const FAIXAS = [
  { inicio: 8, rotulo: '08h–10h' },
  { inicio: 10, rotulo: '10h–12h' },
  { inicio: 13, rotulo: '13h–15h' },
  { inicio: 15, rotulo: '15h–17h' },
  { inicio: 17, rotulo: '17h–19h' },
];
const ANTECEDENCIA_MIN = 60;
const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

function proximosDias() {
  const agora = new Date();
  const dias: { rotulo: string; faixas: typeof FAIXAS }[] = [];
  for (let i = 0; dias.length < 6 && i < 8; i++) {
    const d = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + i);
    const faixas = FAIXAS.filter(
      (f) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), f.inicio).getTime() - agora.getTime() >= ANTECEDENCIA_MIN * 60000,
    );
    if (!faixas.length) continue;
    const dd = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
    dias.push({ rotulo: i === 0 ? `Hoje ${dd}` : i === 1 ? `Amanhã ${dd}` : `${SEMANA[d.getDay()]} ${dd}`, faixas });
  }
  return dias;
}

type Fase = 'escolha' | 'gerando' | 'aguardando' | 'pago';

export default function PedidoTela() {
  const { modo } = useLocalSearchParams<{ modo?: string }>();
  const agendado = modo === 'agendar';
  const { casa, rotas, valorFrete } = useApp();
  const insets = useSafeAreaInsets();
  const [dias] = useState(proximosDias);
  const [mercadoId, setMercadoId] = useState<string | null>(null);
  const [diaIdx, setDiaIdx] = useState(0);
  const [faixa, setFaixa] = useState<string | null>(null);
  const [fase, setFase] = useState<Fase>('escolha');
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const mercado = MERCADOS.find((m) => m.id === mercadoId) ?? null;
  const valor = mercado ? valorFrete(mercado.id, agendado) : null;
  const janela = agendado && faixa ? `${dias[diaIdx].rotulo} · ${faixa}` : undefined;
  const podePagar = !!mercado && valor !== null && (!agendado || !!janela) && fase === 'escolha';

  async function abrirCheckout(p: Pedido) {
    if (!URL_RETORNO_PAGAMENTO) {
      await WebBrowser.openBrowserAsync(p.checkoutUrl);
      return;
    }
    const r = await WebBrowser.openAuthSessionAsync(p.checkoutUrl, Linking.createURL('pagamento'));
    if (r.type !== 'success') return;
    const ret = lerRetorno(r.url);
    if (!ret.slug || !ret.transactionNsu) return;
    const st = await verificarPagamento({ orderNsu: ret.orderNsu ?? p.orderNsu, slug: ret.slug, transactionNsu: ret.transactionNsu }).catch(
      () => null,
    );
    if (st?.pago) {
      const pago: Pedido = { ...p, status: 'pago', receiptUrl: ret.receiptUrl, metodo: st.metodo ?? ret.captureMethod };
      await salvarPedido(pago).catch(() => {});
      setPedido(pago);
      setFase('pago');
    }
  }

  async function pagar() {
    if (!mercado || valor === null || !casa) return;
    setErro(null);
    setFase('gerando');
    const orderNsu = novoOrderNsu();
    try {
      const checkoutUrl = await criarLinkPagamento({
        orderNsu,
        valor,
        descricao: `Frete ${mercado.nome} - ${agendado ? `agendado ${janela}` : 'entrega agora'}`,
        redirectUrl: URL_RETORNO_PAGAMENTO ?? undefined,
        cliente: { name: casa.nome !== 'Minha casa' ? casa.nome : undefined },
      });
      const p: Pedido = {
        orderNsu,
        mercadoId: mercado.id,
        mercadoNome: mercado.nome,
        valor,
        agendado,
        janela,
        criadoEm: new Date().toISOString(),
        checkoutUrl,
        status: 'aguardando',
      };
      await salvarPedido(p).catch(() => {});
      setPedido(p);
      setFase('aguardando');
      await abrirCheckout(p);
    } catch (e) {
      setErro((e as Error).message);
      setFase('escolha');
    }
  }

  if (fase === 'pago' && pedido) {
    return (
      <View style={s.fim}>
        <Text style={s.fimIcone}>✓</Text>
        <Text style={s.fimTitulo}>Frete pago!</Text>
        <Text style={s.fimTexto}>
          {pedido.mercadoNome}
          {'\n'}
          {pedido.agendado ? `Entrega ${pedido.janela}` : 'Entrega o quanto antes'}
        </Text>
        <Text style={s.fimValor}>{formatarReais(pedido.valor)}</Text>
        {pedido.receiptUrl && (
          <Pressable onPress={() => WebBrowser.openBrowserAsync(pedido.receiptUrl!)}>
            <Text style={s.link}>Ver comprovante</Text>
          </Pressable>
        )}
        <Pressable style={[s.botao, { alignSelf: 'stretch' }]} onPress={() => router.replace('/')}>
          <Text style={s.botaoTexto}>Concluir</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: agendado ? 'Agendar frete' : 'Solicitar frete' }} />
      <ScrollView contentContainerStyle={s.conteudo}>
        <Text style={s.secao}>De qual mercado?</Text>
        <View style={{ gap: 8 }}>
          {MERCADOS.map((m) => {
            const v = valorFrete(m.id, agendado);
            const ativo = m.id === mercadoId;
            const semRota = rotas !== null && v === null;
            return (
              <Pressable
                key={m.id}
                disabled={semRota || fase !== 'escolha'}
                onPress={() => setMercadoId(m.id)}
                style={[s.mercado, ativo && s.mercadoAtivo, semRota && { opacity: 0.4 }]}
                accessibilityRole="radio"
                accessibilityState={{ selected: ativo }}
              >
                <Text style={[s.mercadoNome, ativo && { color: cores.primaria }]}>{m.nome}</Text>
                {rotas === null ? (
                  <ActivityIndicator color={cores.primaria} />
                ) : (
                  <Text style={[s.mercadoValor, ativo && { color: cores.primaria }]}>{v === null ? 'indisponível' : formatarReais(v)}</Text>
                )}
              </Pressable>
            );
          })}
        </View>

        {agendado && (
          <>
            <Text style={s.secao}>Quando?</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {dias.map((d, i) => (
                <Chip key={d.rotulo} texto={d.rotulo} ativo={i === diaIdx} onPress={() => { setDiaIdx(i); setFaixa(null); }} />
              ))}
            </ScrollView>
            <View style={s.faixas}>
              {dias[diaIdx]?.faixas.map((f) => (
                <Chip key={f.rotulo} texto={f.rotulo} ativo={faixa === f.rotulo} onPress={() => setFaixa(f.rotulo)} />
              ))}
            </View>
          </>
        )}

        {fase === 'aguardando' && pedido && (
          <View style={s.aviso}>
            <Text style={s.avisoTexto}>Pagamento aberto. Ao concluir, a InfinitePay mostra o comprovante.</Text>
            <Pressable onPress={() => abrirCheckout(pedido)}>
              <Text style={s.link}>Continuar pagamento</Text>
            </Pressable>
          </View>
        )}
        {erro && <Text style={s.erro}>{erro}</Text>}
      </ScrollView>

      <View style={[s.rodape, { paddingBottom: 12 + insets.bottom }]}>
        <View style={{ flex: 1 }}>
          <Text style={s.rodapeRotulo}>Valor do frete</Text>
          <Text style={s.rodapeValor}>{valor === null ? '—' : formatarReais(valor)}</Text>
        </View>
        <Pressable style={[s.botao, s.botaoRodape, !podePagar && { opacity: 0.45 }]} disabled={!podePagar} onPress={pagar}>
          {fase === 'gerando' ? <ActivityIndicator color="#fff" /> : <Text style={s.botaoTexto}>Pagar</Text>}
        </Pressable>
      </View>
    </View>
  );
}

function Chip({ texto, ativo, onPress }: { texto: string; ativo: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[s.chip, ativo && s.chipAtivo]} accessibilityRole="radio" accessibilityState={{ selected: ativo }}>
      <Text style={[s.chipTexto, ativo && { color: '#fff' }]}>{texto}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  conteudo: { padding: 16, paddingBottom: 30 },
  secao: { fontSize: 17, fontWeight: '800', color: cores.texto, marginTop: 12, marginBottom: 10 },
  mercado: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: cores.cartao,
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio,
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  mercadoAtivo: { borderColor: cores.primaria, borderWidth: 2, backgroundColor: cores.primariaClara, paddingVertical: 15, paddingHorizontal: 15 },
  mercadoNome: { fontSize: 16, fontWeight: '600', color: cores.texto, flexShrink: 1 },
  mercadoValor: { fontSize: 18, fontWeight: '800', color: cores.texto, fontVariant: ['tabular-nums'] },
  faixas: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  chip: { borderWidth: 1, borderColor: cores.borda, borderRadius: 999, paddingVertical: 9, paddingHorizontal: 14, backgroundColor: cores.cartao },
  chipAtivo: { backgroundColor: cores.primaria, borderColor: cores.primaria },
  chipTexto: { fontSize: 14, fontWeight: '600', color: cores.texto },
  aviso: { marginTop: 16, backgroundColor: cores.alertaFundo, borderRadius: 12, padding: 12, gap: 4 },
  avisoTexto: { color: cores.alerta, fontSize: 14 },
  erro: { color: cores.erro, marginTop: 12, fontSize: 14 },
  link: { color: cores.primaria, fontWeight: '700', fontSize: 15, paddingVertical: 6 },
  rodape: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: cores.cartao,
    borderTopWidth: 1,
    borderTopColor: cores.borda,
  },
  rodapeRotulo: { fontSize: 13, color: cores.suave },
  rodapeValor: { fontSize: 26, fontWeight: '800', color: cores.primaria, fontVariant: ['tabular-nums'] },
  botao: { backgroundColor: cores.primaria, borderRadius: raio, paddingVertical: 16, alignItems: 'center', marginTop: 12 },
  botaoRodape: { marginTop: 0, paddingHorizontal: 36 },
  botaoTexto: { color: '#fff', fontSize: 17, fontWeight: '700' },
  fim: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 },
  fimIcone: { fontSize: 56, color: cores.primaria },
  fimTitulo: { fontSize: 26, fontWeight: '800', color: cores.texto },
  fimTexto: { fontSize: 16, color: cores.suave, textAlign: 'center' },
  fimValor: { fontSize: 30, fontWeight: '800', color: cores.primaria, marginVertical: 6 },
});
