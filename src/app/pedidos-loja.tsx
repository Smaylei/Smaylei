import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, Vibration, View } from 'react-native';
import { cores, raio } from '../components/tema';
import { ErroApi } from '../services/api';
import * as D from '../services/delivery';
import { formatarReais } from '../services/preco';

const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const MOTIVOS = ['Acabou um produto', 'Loja fechando', 'Muito movimento agora'];

/** Pedidos do delivery recebidos pela loja (aceitar/recusar e acompanhar) e as vendas a receber. */
export default function PedidosLoja() {
  const params = useLocalSearchParams<{ aba?: string }>();
  const [aba, setAba] = useState<'pedidos' | 'vendas'>(params.aba === 'vendas' ? 'vendas' : 'pedidos');
  const [pedidos, setPedidos] = useState<D.Pedido[] | null>(null);
  const [vendas, setVendas] = useState<D.Vendas | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const novosAntes = useRef(-1);

  const carregar = useCallback(() => {
    D.pedidosDaLoja().then(setPedidos).catch(() => {});
    D.vendas().then(setVendas).catch(() => {});
  }, []);
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
  // Pedido novo chegando: vibra o celular.
  useEffect(() => {
    if (!pedidos) return;
    const novos = pedidos.filter((p) => p.status === 'aguardando_loja').length;
    if (novosAntes.current >= 0 && novos > novosAntes.current) Vibration.vibrate([0, 400, 200, 400]);
    novosAntes.current = novos;
  }, [pedidos]);

  async function responder(p: D.Pedido, acao: 'aceitar' | 'recusar', motivo?: string) {
    setOcupado(p.id);
    try {
      await D.responderPedido(p.id, acao, motivo);
      carregar();
    } catch (e) {
      Alert.alert('Pedido', e instanceof ErroApi ? e.message : 'Tente de novo.');
    } finally {
      setOcupado(null);
    }
  }
  function recusar(p: D.Pedido) {
    Alert.alert(`Recusar o pedido #${p.codigo}?`, 'O cliente recebe o valor de volta.', [
      ...MOTIVOS.map((m) => ({ text: m, onPress: () => responder(p, 'recusar', m) })),
      { text: 'Voltar', style: 'cancel' as const },
    ]);
  }
  async function repasse() {
    try {
      const r = await D.pedirRepasse();
      Alert.alert('Repasse solicitado', `${formatarReais(r.valor)} serão enviados por Pix para a chave da loja.`);
      carregar();
    } catch (e) {
      Alert.alert('Repasse', e instanceof ErroApi ? e.message : 'Tente de novo.');
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: 'Pedidos do delivery' }} />
      <View style={s.abas}>
        {(['pedidos', 'vendas'] as const).map((a) => (
          <Pressable key={a} style={[s.aba, aba === a && s.abaAtiva]} onPress={() => setAba(a)}>
            <Text style={[s.abaTexto, aba === a && { color: '#fff' }]}>{a === 'pedidos' ? 'Pedidos' : 'Vendas e repasses'}</Text>
          </Pressable>
        ))}
      </View>
      <ScrollView contentContainerStyle={s.conteudo} refreshControl={<RefreshControl refreshing={false} onRefresh={carregar} tintColor={cores.primaria} />}>
        {aba === 'pedidos' && !pedidos && <ActivityIndicator style={{ marginTop: 40 }} color={cores.primaria} />}
        {aba === 'pedidos' && pedidos?.length === 0 && <Text style={s.vazio}>Nenhum pedido nas últimas 48 horas. Deixe a loja aberta na vitrine para receber pedidos.</Text>}
        {aba === 'pedidos' &&
          pedidos?.map((p) => {
            const novo = p.status === 'aguardando_loja';
            return (
              <View key={p.id} style={[s.pedido, novo && s.pedidoNovo, p.status === 'cancelado' && { opacity: 0.6 }]}>
                <View style={s.cabeca}>
                  <Text style={s.codigo}>
                    #{p.codigo} · {p.cliente?.nome}
                  </Text>
                  <Text style={s.hora}>{hora(p.pagoEm ?? p.criadoEm)}</Text>
                </View>
                <Text style={[s.etapa, { color: novo ? cores.primaria : p.status === 'cancelado' ? cores.erro : p.status === 'entregue' ? cores.sucesso : cores.texto }]}>
                  {novo ? '🔔 Pedido novo' : D.etapaPedido(p)}
                </Text>
                {p.itens.map((i) => (
                  <Text key={i.produtoId} style={s.item}>
                    {i.qtd}× {i.nome} <Text style={s.suave}>· {formatarReais(i.preco * i.qtd)}</Text>
                  </Text>
                ))}
                {!!p.observacao && <Text style={s.obs}>📝 {p.observacao}</Text>}
                <Text style={s.suave}>
                  Produtos: <Text style={{ color: cores.texto, fontWeight: '700' }}>{formatarReais(p.subtotal)}</Text> (100% da loja) · pago por {p.metodo === 'pix' ? 'Pix' : 'cartão'}
                </Text>
                {novo && (
                  <>
                    {p.aceiteAte && <Text style={s.prazo}>Aceite até {hora(p.aceiteAte)}, senão o pedido é cancelado.</Text>}
                    <View style={s.botoes}>
                      <Pressable style={s.recusar} disabled={ocupado === p.id} onPress={() => recusar(p)}>
                        <Text style={s.recusarTexto}>Recusar</Text>
                      </Pressable>
                      <Pressable style={[s.aceitar, ocupado === p.id && { opacity: 0.5 }]} disabled={ocupado === p.id} onPress={() => responder(p, 'aceitar')}>
                        {ocupado === p.id ? <ActivityIndicator color="#fff" /> : <Text style={s.aceitarTexto}>Aceitar e chamar entregador</Text>}
                      </Pressable>
                    </View>
                  </>
                )}
                {p.status === 'aceito' && p.motorista && (
                  <Text style={s.entregador}>
                    Entregue para: {p.motorista.veiculo === 'moto' ? '🏍️' : '🚗'} {p.motorista.nome} · {p.motorista.carro} · {p.motorista.placa}
                  </Text>
                )}
                {p.status === 'cancelado' && !!p.motivo && <Text style={s.suave}>{p.motivo}</Text>}
              </View>
            );
          })}

        {aba === 'vendas' && !vendas && <ActivityIndicator style={{ marginTop: 40 }} color={cores.primaria} />}
        {aba === 'vendas' && vendas && (
          <>
            <View style={s.saldo}>
              <Text style={s.saldoRotulo}>A receber</Text>
              <Text style={s.saldoValor}>{formatarReais(vendas.disponivel)}</Text>
              <Text style={s.saldoSub}>
                Em andamento: {formatarReais(vendas.emAndamento)} · total vendido: {formatarReais(vendas.totalVendido)}
                {vendas.recebidoDireto ? ` · ${formatarReais(vendas.recebidoDireto)} já caíram direto na conta da loja` : ''}
              </Text>
            </View>
            <Pressable style={[s.aceitar, (vendas.disponivel < 1 || !!vendas.proximoRepasseEm) && { opacity: 0.45 }]} disabled={vendas.disponivel < 1 || !!vendas.proximoRepasseEm} onPress={repasse}>
              <Text style={s.aceitarTexto}>Pedir repasse por Pix</Text>
            </Pressable>
            <Text style={s.suave}>
              {vendas.proximoRepasseEm
                ? `Próximo repasse a partir de ${new Date(vendas.proximoRepasseEm).toLocaleDateString('pt-BR')}.`
                : `1 repasse a cada ${vendas.intervaloDias} dias, na chave Pix ${vendas.chavePix}.`}{' '}
              As vendas entram aqui quando o cliente recebe o pedido.
            </Text>
            {vendas.repasses.length > 0 && <Text style={s.secao}>Repasses</Text>}
            {vendas.repasses.map((r) => (
              <View key={r.id} style={s.linha}>
                <Text style={s.item}>
                  {r.status === 'pago' ? '✓ Pago' : r.status === 'recusado' ? '✕ Recusado' : '⏳ Solicitado'} · {new Date(r.criadoEm).toLocaleDateString('pt-BR')}
                </Text>
                <Text style={s.item}>{formatarReais(r.valor)}</Text>
              </View>
            ))}
            {vendas.vendas.length > 0 && <Text style={s.secao}>Vendas entregues</Text>}
            {vendas.vendas.map((v) => (
              <View key={v.id} style={s.linha}>
                <Text style={s.item}>
                  #{v.codigo} · {new Date(v.liberadoEm).toLocaleDateString('pt-BR')}
                </Text>
                <Text style={[s.item, { color: cores.sucesso }]}>+ {formatarReais(v.subtotal)}</Text>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  abas: { flexDirection: 'row', gap: 8, padding: 16, paddingBottom: 0 },
  aba: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: cores.borda, backgroundColor: cores.cartao },
  abaAtiva: { backgroundColor: cores.primaria, borderColor: cores.primaria },
  abaTexto: { color: cores.texto, fontWeight: '700' },
  conteudo: { padding: 16, gap: 12, paddingBottom: 40 },
  vazio: { color: cores.suave, textAlign: 'center', padding: 30, lineHeight: 20 },
  pedido: { backgroundColor: cores.cartao, borderRadius: raio + 2, padding: 16, gap: 6, borderWidth: 1, borderColor: cores.borda },
  pedidoNovo: { borderColor: cores.primaria, borderWidth: 2 },
  cabeca: { flexDirection: 'row', justifyContent: 'space-between' },
  codigo: { fontSize: 17, fontWeight: '800', color: cores.texto },
  hora: { fontSize: 13, color: cores.suave },
  etapa: { fontSize: 14, fontWeight: '700' },
  item: { fontSize: 15, color: cores.texto },
  suave: { fontSize: 13, color: cores.suave, lineHeight: 18 },
  obs: { fontSize: 14, color: cores.alerta, backgroundColor: cores.alertaFundo, borderRadius: 10, padding: 8 },
  prazo: { fontSize: 13, color: cores.alerta, fontWeight: '600' },
  botoes: { flexDirection: 'row', gap: 10, marginTop: 6 },
  recusar: { borderRadius: raio, paddingVertical: 14, paddingHorizontal: 16, borderWidth: 1.5, borderColor: cores.erro, alignItems: 'center' },
  recusarTexto: { color: cores.erro, fontWeight: '700' },
  aceitar: { flex: 1, backgroundColor: cores.primaria, borderRadius: raio, paddingVertical: 14, alignItems: 'center' },
  aceitarTexto: { color: '#fff', fontWeight: '700', fontSize: 15 },
  entregador: { fontSize: 14, color: cores.texto, fontWeight: '600', marginTop: 4 },
  saldo: { backgroundColor: cores.primaria, borderRadius: raio + 2, padding: 18, gap: 4 },
  saldoRotulo: { color: 'rgba(255,255,255,0.85)', fontWeight: '700', fontSize: 13 },
  saldoValor: { color: '#fff', fontSize: 30, fontWeight: '800' },
  saldoSub: { color: 'rgba(255,255,255,0.85)', fontSize: 13 },
  secao: { fontSize: 13, fontWeight: '800', color: cores.primaria, letterSpacing: 1, textTransform: 'uppercase', marginTop: 8 },
  linha: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: cores.cartao, borderRadius: raio, padding: 12, borderWidth: 1, borderColor: cores.borda },
});
