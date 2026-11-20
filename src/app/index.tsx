import { Redirect, router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { cores, raio } from '../components/tema';
import { API_PAGAMENTOS } from '../config';
import { useApp } from '../estado/AppContext';
import { consultarPedidoServidor } from '../services/pagamento';
import { listarPedidos, salvarPedido, type Pedido } from '../services/pedidos';
import { formatarReais } from '../services/preco';

const HORAS_RECENTE = 24;

/** Último frete do cliente, atualizando no servidor se ainda estiver aguardando pagamento. */
function useUltimoPedido() {
  const [pedido, setPedido] = useState<Pedido | null>(null);
  useFocusEffect(
    useCallback(() => {
      let ativo = true;
      (async () => {
        const [p] = await listarPedidos();
        if (!p || Date.now() - new Date(p.criadoEm).getTime() > HORAS_RECENTE * 3600e3) return;
        let atual = p;
        if (p.status !== 'pago' && API_PAGAMENTOS) {
          const st = await consultarPedidoServidor(API_PAGAMENTOS, p.orderNsu).catch(() => null);
          if (st?.pago) {
            atual = { ...p, status: 'pago', receiptUrl: st.receiptUrl, metodo: st.metodo };
            await salvarPedido(atual).catch(() => {});
          }
        }
        if (ativo) setPedido(atual);
      })();
      return () => {
        ativo = false;
      };
    }, []),
  );
  return pedido;
}

export default function Inicio() {
  const { carregado, casa } = useApp();
  const ultimo = useUltimoPedido();

  if (!carregado) return <ActivityIndicator style={{ marginTop: 60 }} color={cores.primaria} />;
  if (!casa) return <Redirect href="/cadastro" />;

  return (
    <ScrollView contentContainerStyle={s.conteudo}>
      {/* Toque longo no título abre a administração das tarifas */}
      <Pressable onLongPress={() => router.push('/admin')} delayLongPress={1500}>
        <Text style={s.ola}>Olá{casa.nome && casa.nome !== 'Minha casa' ? `, ${casa.nome}` : ''}!</Text>
      </Pressable>
      <Text style={s.sub}>Suas compras do mercado entregues em casa.</Text>

      {ultimo && (
        <Pressable
          style={[s.status, ultimo.status === 'pago' ? s.statusOk : s.statusAguardando]}
          onPress={() => router.push({ pathname: '/pagamento', params: { order_nsu: ultimo.orderNsu } })}
        >
          <Text style={[s.statusTitulo, { color: ultimo.status === 'pago' ? cores.primaria : cores.alerta }]}>
            {ultimo.status === 'pago' ? '✓ Frete confirmado' : 'Aguardando pagamento'}
          </Text>
          <Text style={s.statusTexto}>
            {ultimo.mercadoNome} · {ultimo.agendado ? ultimo.janela : 'entrega agora'} · {formatarReais(ultimo.valor)}
          </Text>
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
