import * as Linking from 'expo-linking';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { cores, raio } from '../components/tema';
import { API_PAGAMENTOS } from '../config';
import { MERCADOS } from '../data/mercados';
import { useApp } from '../estado/AppContext';
import {
  consultarPedidoServidor,
  criarPedidoServidor,
  obterDisponibilidade,
  type Disponibilidade,
} from '../services/pagamento';
import { salvarPedido, type Pedido } from '../services/pedidos';
import { formatarReais } from '../services/preco';

type Fase = 'escolha' | 'gerando' | 'aguardando' | 'pago';

export default function PedidoTela() {
  const { modo } = useLocalSearchParams<{ modo?: string }>();
  const agendado = modo === 'agendar';
  const { casa, rotas, valorFrete } = useApp();
  const insets = useSafeAreaInsets();
  const [disp, setDisp] = useState<Disponibilidade | null>(null);
  const [erroDisp, setErroDisp] = useState<string | null>(null);
  const [mercadoId, setMercadoId] = useState<string | null>(null);
  const [diaIdx, setDiaIdx] = useState(0);
  const [inicio, setInicio] = useState<string | null>(null);
  const [fase, setFase] = useState<Fase>('escolha');
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!API_PAGAMENTOS) return;
    try {
      setDisp(await obterDisponibilidade(API_PAGAMENTOS));
      setErroDisp(null);
    } catch (e) {
      setErroDisp((e as Error).message);
    }
  }, []);

  useEffect(() => {
    // A primeira busca acontece fora do corpo do efeito (em um timer), como pede o lint.
    const t = setTimeout(carregar, 0);
    return () => clearTimeout(t);
  }, [carregar]);

  const mercado = MERCADOS.find((m) => m.id === mercadoId) ?? null;
  const valor = mercado ? valorFrete(mercado.id, agendado) : null;
  const dia = disp?.dias[diaIdx];
  const hora = dia?.horarios.find((h) => h.inicio === inicio)?.hora;
  const agoraOk = !agendado ? (disp?.agora.ok ?? false) : true;
  const podePagar = !!mercado && valor !== null && agoraOk && (!agendado || !!inicio) && fase === 'escolha';

  async function abrirCheckout(p: Pedido) {
    if (!API_PAGAMENTOS) return;
    await WebBrowser.openAuthSessionAsync(p.checkoutUrl, Linking.createURL('pagamento'));
    const st = await consultarPedidoServidor(API_PAGAMENTOS, p.orderNsu).catch(() => null);
    if (st?.pago) {
      const pago: Pedido = { ...p, status: 'pago', receiptUrl: st.receiptUrl, metodo: st.metodo };
      await salvarPedido(pago).catch(() => {});
      setPedido(pago);
      setFase('pago');
    }
  }

  async function pagar() {
    if (!mercado || !casa || !API_PAGAMENTOS) return;
    setErro(null);
    setFase('gerando');
    try {
      const r = await criarPedidoServidor(API_PAGAMENTOS, {
        mercadoId: mercado.id,
        agendado,
        inicio: agendado ? (inicio ?? undefined) : undefined,
        cliente: { nome: casa.nome, endereco: casa.endereco, telefone: casa.telefone, lat: casa.lat, lon: casa.lon },
      });
      const p: Pedido = {
        orderNsu: r.orderNsu,
        mercadoId: mercado.id,
        mercadoNome: mercado.nome,
        valor: r.valor,
        agendado,
        janela: r.janela,
        inicio: r.inicio,
        cancelToken: r.cancelToken,
        criadoEm: new Date().toISOString(),
        checkoutUrl: r.url,
        status: 'aguardando',
      };
      await salvarPedido(p).catch(() => {});
      setPedido(p);
      setFase('aguardando');
      await abrirCheckout(p);
    } catch (e) {
      setErro((e as Error).message);
      setFase('escolha');
      setInicio(null);
      carregar(); // o horário pode ter sido ocupado por outra pessoa
    }
  }

  if (fase === 'pago' && pedido) {
    return (
      <View style={s.fim}>
        <Text style={s.fimIcone}>✓</Text>
        <Text style={s.fimTitulo}>Frete confirmado!</Text>
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
        {!agendado && disp && !disp.agora.ok && (
          <View style={s.aviso}>
            <Text style={s.avisoTitulo}>Indisponível agora</Text>
            <Text style={s.avisoTexto}>{disp.agora.motivo}</Text>
            {disp.dias.length > 0 && (
              <Pressable onPress={() => router.replace({ pathname: '/pedido', params: { modo: 'agendar' } })}>
                <Text style={s.link}>Agendar um horário</Text>
              </Pressable>
            )}
          </View>
        )}
        {erroDisp && <Text style={s.erro}>{erroDisp}</Text>}

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
            {!disp ? (
              <ActivityIndicator color={cores.primaria} />
            ) : disp.dias.length === 0 ? (
              <Text style={s.avisoTexto}>Sem horários livres no momento.</Text>
            ) : (
              <>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  {disp.dias.map((d, i) => (
                    <Chip
                      key={d.data}
                      texto={d.rotulo}
                      ativo={i === diaIdx}
                      onPress={() => {
                        setDiaIdx(i);
                        setInicio(null);
                      }}
                    />
                  ))}
                </ScrollView>
                <View style={s.faixas}>
                  {dia?.horarios.map((h) => (
                    <Chip key={h.inicio} texto={h.hora} ativo={inicio === h.inicio} onPress={() => setInicio(h.inicio)} />
                  ))}
                </View>
              </>
            )}
          </>
        )}

        {fase === 'aguardando' && pedido && (
          <View style={s.aviso}>
            <Text style={s.avisoTexto}>Pagamento aberto. O horário fica reservado por 15 minutos.</Text>
            <Pressable onPress={() => abrirCheckout(pedido)}>
              <Text style={s.link}>Continuar pagamento</Text>
            </Pressable>
          </View>
        )}
        {erro && <Text style={s.erro}>{erro}</Text>}
      </ScrollView>

      <View style={[s.rodape, { paddingBottom: 12 + insets.bottom }]}>
        <View style={{ flex: 1 }}>
          <Text style={s.rodapeRotulo}>{agendado && hora ? `${dia?.rotulo} · ${hora}` : 'Valor do frete'}</Text>
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
  aviso: { marginTop: 8, marginBottom: 4, backgroundColor: cores.alertaFundo, borderRadius: 12, padding: 12, gap: 4 },
  avisoTitulo: { color: cores.alerta, fontSize: 15, fontWeight: '800' },
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
