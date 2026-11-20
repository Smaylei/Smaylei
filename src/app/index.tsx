import { Redirect, router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { cores, raio } from '../components/tema';
import { API_PAGAMENTOS } from '../config';
import { useApp } from '../estado/AppContext';
import { cancelarPedidoServidor, consultarPedidoServidor } from '../services/pagamento';
import { listarPedidos, salvarPedido, type Pedido } from '../services/pedidos';
import { formatarReais } from '../services/preco';
import { EH_ADMIN } from '../variante';

const HORAS_RECENTE = 24;

/** Último frete do cliente, atualizando no servidor se ainda estiver aguardando pagamento. */
function useUltimoPedido() {
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const [podeCancelar, setPodeCancelar] = useState(false);

  const carregar = useCallback(async () => {
    const [p] = await listarPedidos();
    // Mostra o último frete: o recente ou um agendamento que ainda vai acontecer.
    const futuro = p?.inicio && Date.parse(p.inicio) > Date.now();
    if (!p || (!futuro && Date.now() - new Date(p.criadoEm).getTime() > HORAS_RECENTE * 3600e3)) {
      setPedido(null);
      return;
    }
    let atual = p;
    let cancelavel = false;
    if (API_PAGAMENTOS && p.status !== 'cancelado') {
      const st = await consultarPedidoServidor(API_PAGAMENTOS, p.orderNsu).catch(() => null);
      if (st) {
        const status = st.status === 'reservado' ? 'aguardando' : st.status;
        atual = { ...p, status, receiptUrl: st.receiptUrl ?? p.receiptUrl, metodo: st.metodo ?? p.metodo };
        cancelavel = st.podeCancelar && !!p.cancelToken;
        if (status !== p.status) await salvarPedido(atual).catch(() => {});
      }
    }
    setPedido(atual);
    setPodeCancelar(cancelavel);
  }, []);

  useFocusEffect(
    useCallback(() => {
      carregar();
    }, [carregar]),
  );
  return { pedido, podeCancelar, recarregar: carregar };
}

export default function Inicio() {
  const { carregado, casa } = useApp();
  const { pedido: ultimo, podeCancelar, recarregar } = useUltimoPedido();

  if (EH_ADMIN) return <Redirect href="/painel" />;
  if (!carregado) return <ActivityIndicator style={{ marginTop: 60 }} color={cores.primaria} />;
  if (!casa) return <Redirect href="/cadastro" />;

  return (
    <ScrollView contentContainerStyle={s.conteudo}>
      <Text style={s.ola}>Olá{casa.nome && casa.nome !== 'Minha casa' ? `, ${casa.nome}` : ''}!</Text>
      <Text style={s.sub}>Suas compras do mercado entregues em casa.</Text>

      {ultimo && (
        <Pressable
          style={[s.status, ultimo.status === 'cancelado' ? s.statusCancelado : ultimo.status === 'aguardando' ? s.statusAguardando : s.statusOk]}
          onPress={() => router.push({ pathname: '/pagamento', params: { order_nsu: ultimo.orderNsu } })}
        >
          <Text
            style={[s.statusTitulo, { color: ultimo.status === 'cancelado' ? cores.erro : ultimo.status === 'aguardando' ? cores.alerta : cores.primaria }]}
          >
            {{ pago: '✓ Frete confirmado', concluido: '✓ Frete concluído', aguardando: 'Aguardando pagamento', cancelado: '✕ Frete cancelado' }[ultimo.status]}
          </Text>
          <Text style={s.statusTexto}>
            {ultimo.mercadoNome} · {ultimo.agendado ? ultimo.janela : 'entrega agora'} · {formatarReais(ultimo.valor)}
          </Text>
          {podeCancelar && (
            <Pressable
              hitSlop={8}
              onPress={() =>
                Alert.alert('Cancelar frete?', 'O horário fica livre para outra pessoa. Se você já pagou, o valor é devolvido pela loja.', [
                  { text: 'Voltar', style: 'cancel' },
                  {
                    text: 'Cancelar frete',
                    style: 'destructive',
                    onPress: async () => {
                      try {
                        await cancelarPedidoServidor(API_PAGAMENTOS!, ultimo.orderNsu, ultimo.cancelToken!);
                        await salvarPedido({ ...ultimo, status: 'cancelado' });
                        recarregar();
                      } catch (e) {
                        Alert.alert('Não foi possível cancelar', (e as Error).message);
                      }
                    },
                  },
                ])
              }
            >
              <Text style={s.cancelar}>Cancelar este frete</Text>
            </Pressable>
          )}
        </Pressable>
      )}

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
  status: { borderRadius: raio, padding: 14, borderWidth: 1 },
  statusOk: { backgroundColor: cores.primariaClara, borderColor: cores.primaria },
  statusAguardando: { backgroundColor: cores.alertaFundo, borderColor: cores.alerta },
  statusCancelado: { backgroundColor: cores.cartao, borderColor: cores.borda },
  cancelar: { color: cores.erro, fontWeight: '700', fontSize: 14, marginTop: 8 },
  statusTitulo: { fontSize: 16, fontWeight: '800' },
  statusTexto: { fontSize: 14, color: cores.texto, marginTop: 2 },
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
