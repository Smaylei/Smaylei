import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { cores, raio } from '../components/tema';
import { API_PAGAMENTOS } from '../config';
import { consultarPedidoServidor } from '../services/pagamento';
import { listarPedidos, salvarPedido, type Pedido } from '../services/pedidos';
import { formatarReais } from '../services/preco';

/**
 * Aberta pelo link mercadofrete://pagamento?order_nsu=... que o servidor manda depois que a
 * InfinitePay confirma o pagamento. Mostra a confirmação do frete para o cliente.
 */
export default function Pagamento() {
  const { order_nsu } = useLocalSearchParams<{ order_nsu?: string }>();
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let ativo = true;
    (async () => {
      const lista = await listarPedidos();
      let p = lista.find((x) => x.orderNsu === order_nsu) ?? null;
      if (p && p.status !== 'pago' && API_PAGAMENTOS) {
        const st = await consultarPedidoServidor(API_PAGAMENTOS, p.orderNsu).catch(() => null);
        if (st?.pago) {
          p = { ...p, status: 'pago', receiptUrl: st.receiptUrl, metodo: st.metodo };
          await salvarPedido(p).catch(() => {});
        }
      }
      if (ativo) {
        setPedido(p);
        setCarregando(false);
      }
    })();
    return () => {
      ativo = false;
    };
  }, [order_nsu]);

  if (carregando) return <ActivityIndicator style={{ marginTop: 60 }} color={cores.primaria} />;

  const pago = pedido?.status === 'pago';
  return (
    <View style={s.fim}>
      <Text style={[s.icone, !pago && { color: cores.alerta }]}>{pago ? '✓' : '…'}</Text>
      <Text style={s.titulo}>{pago ? 'Frete confirmado!' : 'Aguardando confirmação'}</Text>
      {pedido && (
        <>
          <Text style={s.texto}>
            {pedido.mercadoNome}
            {'\n'}
            {pedido.agendado ? `Entrega ${pedido.janela}` : 'Entrega o quanto antes'}
          </Text>
          <Text style={s.valor}>{formatarReais(pedido.valor)}</Text>
        </>
      )}
      {!pago && <Text style={s.texto}>Assim que a InfinitePay confirmar, o frete aparece como confirmado na tela inicial.</Text>}
      {pedido?.receiptUrl && (
        <Pressable onPress={() => WebBrowser.openBrowserAsync(pedido.receiptUrl!)}>
          <Text style={s.link}>Ver comprovante</Text>
        </Pressable>
      )}
      <Pressable style={s.botao} onPress={() => router.replace('/')}>
        <Text style={s.botaoTexto}>Concluir</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  fim: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 },
  icone: { fontSize: 56, color: cores.primaria },
  titulo: { fontSize: 26, fontWeight: '800', color: cores.texto, textAlign: 'center' },
  texto: { fontSize: 16, color: cores.suave, textAlign: 'center' },
  valor: { fontSize: 30, fontWeight: '800', color: cores.primaria, marginVertical: 6 },
  link: { color: cores.primaria, fontWeight: '700', fontSize: 15, paddingVertical: 6 },
  botao: { alignSelf: 'stretch', backgroundColor: cores.primaria, borderRadius: raio, paddingVertical: 16, alignItems: 'center', marginTop: 16 },
  botaoTexto: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
