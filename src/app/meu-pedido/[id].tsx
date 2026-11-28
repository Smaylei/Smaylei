import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { cores, raio } from '../../components/tema';
import { useApp } from '../../estado/AppContext';
import { irParaPagamento } from '../../services/pagamento';
import { ErroApi } from '../../services/api';
import * as D from '../../services/delivery';
import { formatarReais } from '../../services/preco';

const PASSOS = ['Pago', 'Loja aceitou', 'Saiu para entrega', 'Entregue'];

function passoAtual(p: D.Pedido) {
  if (p.status === 'entregue') return 3;
  if (p.status === 'aceito') return p.corridaStatus === 'em_andamento' ? 2 : 1;
  if (p.status === 'aguardando_loja') return 0;
  return -1;
}

/** Pedido do delivery: etapa, itens, valores e o acompanhamento da entrega no mapa. */
export default function MeuPedido() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { config } = useApp();
  const [p, setP] = useState<D.Pedido | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(() => {
    D.pedido(id)
      .then((x) => {
        setP(x);
        setErro(null);
      })
      .catch((e) => setErro((e as Error).message));
  }, [id]);
  useFocusEffect(
    useCallback(() => {
      const t0 = setTimeout(carregar, 0);
      const t = setInterval(carregar, 5000);
      return () => {
        clearTimeout(t0);
        clearInterval(t);
      };
    }, [carregar]),
  );

  if (!p) return erro ? <Text style={[s.erro, { padding: 20 }]}>{erro}</Text> : <ActivityIndicator style={{ marginTop: 60 }} color={cores.primaria} />;
  const atual = passoAtual(p);

  function cancelar() {
    Alert.alert('Cancelar o pedido?', p!.status === 'aguardando_loja' ? 'A loja ainda não aceitou. O valor pago é devolvido.' : 'O pagamento ainda não foi feito.', [
      { text: 'Voltar', style: 'cancel' },
      {
        text: 'Cancelar pedido',
        style: 'destructive',
        onPress: () =>
          D.cancelarPedido(p!.id)
            .then(setP)
            .catch((e) => Alert.alert('Pedido', e instanceof ErroApi ? e.message : 'Tente de novo.')),
      },
    ]);
  }

  return (
    <ScrollView contentContainerStyle={s.conteudo}>
      <Stack.Screen options={{ title: `Pedido #${p.codigo}` }} />
      <View style={[s.topo, p.status === 'cancelado' && { backgroundColor: cores.erroFundo }]}>
        <Text style={[s.topoTitulo, p.status === 'cancelado' && { color: cores.erro }]}>{D.etapaPedido(p)}</Text>
        <Text style={s.topoSub}>{p.loja.nome}</Text>
        {p.status === 'aguardando_loja' && p.aceiteAte && (
          <Text style={s.topoSub}>A loja tem até {new Date(p.aceiteAte).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} para aceitar.</Text>
        )}
        {p.status === 'cancelado' && (
          <Text style={s.topoSub}>
            {p.motivo ?? 'Pedido cancelado.'}
            {p.reembolso > 0 ? ` ${formatarReais(p.reembolso)} ${p.reembolsadoEm ? 'devolvidos' : 'serão devolvidos'} para você.` : ''}
          </Text>
        )}
        {atual >= 0 && (
          <View style={s.passos}>
            {PASSOS.map((t, i) => (
              <View key={t} style={{ flex: 1, gap: 4 }}>
                <View style={[s.barra, i <= atual && { backgroundColor: cores.primaria }]} />
                <Text style={[s.passoTexto, i <= atual && { color: cores.texto }]}>{t}</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {p.status === 'pagamento_pendente' && (
        <Pressable style={s.botao} onPress={() => irParaPagamento(config.gateway, 'pedido', p.id)}>
          <Text style={s.botaoTexto}>Pagar {formatarReais(p.total)}</Text>
        </Pressable>
      )}
      {p.corridaId && p.status !== 'cancelado' && (
        <Pressable style={s.botao} onPress={() => router.push(`/corrida/${p.corridaId}`)}>
          <Text style={s.botaoTexto}>{p.status === 'entregue' ? 'Ver entrega e avaliar' : '🗺️ Acompanhar a entrega no mapa'}</Text>
        </Pressable>
      )}
      {p.motorista && p.status === 'aceito' && (
        <Text style={s.info}>
          {p.motorista.veiculo === 'moto' ? '🏍️' : '🚗'} {p.motorista.nome} · {p.motorista.carro} {p.motorista.cor ?? ''} · {p.motorista.placa}
        </Text>
      )}

      <View style={s.cartao}>
        {p.itens.map((i) => (
          <View key={i.produtoId} style={s.linha}>
            <Text style={s.texto}>
              {i.qtd}× {i.nome}
            </Text>
            <Text style={s.texto}>{formatarReais(i.preco * i.qtd)}</Text>
          </View>
        ))}
        <View style={s.divisor} />
        <View style={s.linha}>
          <Text style={s.suave}>Produtos</Text>
          <Text style={s.suave}>{formatarReais(p.subtotal)}</Text>
        </View>
        <View style={s.linha}>
          <Text style={s.suave}>Entrega MOVI ({p.veiculo === 'moto' ? 'moto' : 'carro'})</Text>
          <Text style={s.suave}>{formatarReais(p.frete)}</Text>
        </View>
        {p.taxaPagamento > 0 && (
          <View style={s.linha}>
            <Text style={s.suave}>Taxa do {p.metodo === 'pix' ? 'Pix' : p.metodo === 'debit_card' ? 'débito' : 'cartão'}</Text>
            <Text style={s.suave}>{formatarReais(p.taxaPagamento)}</Text>
          </View>
        )}
        <View style={s.linha}>
          <Text style={[s.texto, { fontWeight: '800' }]}>Total</Text>
          <Text style={[s.texto, { fontWeight: '800' }]}>{formatarReais(p.total + (p.taxaPagamento || 0))}</Text>
        </View>
        {!!p.observacao && <Text style={s.suave}>Obs.: {p.observacao}</Text>}
        {p.pagoEm && <Text style={s.suave}>Pago por {p.metodo === 'pix' ? 'Pix' : p.metodo === 'debit_card' ? 'débito' : 'cartão'} · valor retido até a entrega</Text>}
      </View>
      {(p.status === 'aguardando_loja' || p.status === 'pagamento_pendente') && (
        <Pressable onPress={cancelar}>
          <Text style={s.cancelar}>Cancelar pedido</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  conteudo: { padding: 20, gap: 14 },
  erro: { color: cores.erro, fontSize: 14 },
  topo: { backgroundColor: cores.primariaClara, borderRadius: raio, padding: 16, gap: 4 },
  topoTitulo: { fontSize: 20, fontWeight: '700', color: cores.primaria },
  topoSub: { fontSize: 14, color: cores.texto },
  passos: { flexDirection: 'row', gap: 6, marginTop: 10 },
  barra: { height: 5, borderRadius: 3, backgroundColor: cores.borda },
  passoTexto: { fontSize: 11, color: cores.apagado, fontWeight: '600' },
  botao: { backgroundColor: cores.primaria, borderRadius: raio, paddingVertical: 15, alignItems: 'center' },
  botaoTexto: { color: '#fff', fontSize: 16, fontWeight: '700' },
  info: { fontSize: 14, color: cores.texto },
  cartao: { backgroundColor: cores.cartao, borderRadius: raio, padding: 16, gap: 8, borderWidth: 1, borderColor: cores.borda },
  linha: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  texto: { fontSize: 15, color: cores.texto, flexShrink: 1 },
  suave: { fontSize: 13, color: cores.suave },
  divisor: { height: 1, backgroundColor: cores.borda, marginVertical: 2 },
  cancelar: { color: cores.erro, fontWeight: '700', textAlign: 'center', padding: 10 },
});
