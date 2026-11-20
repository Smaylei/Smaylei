import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import MapaRuas, { type EstadoMapa } from '../../components/MapaRuas';
import { cores, raio } from '../../components/tema';
import { MERCADOS } from '../../data/mercados';
import { useApp } from '../../estado/AppContext';
import { api, fonteImagem, ROTULO_STATUS, type CorridaCliente } from '../../services/api';
import { rotaAte } from '../../services/eta';
import { formatarReais } from '../../services/preco';

const ATUALIZAR_MS = 3000; // o carro anda no mapa a cada atualização
const ETAPAS: CorridaCliente['status'][] = ['buscando', 'aceito', 'no_local', 'em_andamento', 'entregue'];

export default function Corrida() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { casa } = useApp();
  const [c, setC] = useState<CorridaCliente | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [foto, setFoto] = useState<{ uri: string; headers?: Record<string, string> } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setC(await api<CorridaCliente>('cliente', `/v2/corridas/${id}`));
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      const t0 = setTimeout(carregar, 0);
      const t = setInterval(carregar, ATUALIZAR_MS);
      return () => {
        clearTimeout(t0);
        clearInterval(t);
      };
    }, [carregar]),
  );

  const temMotorista = !!c?.motorista?.temFoto;
  useEffect(() => {
    if (temMotorista) fonteImagem('cliente', `/v2/corridas/${id}/foto-motorista`).then(setFoto);
  }, [temMotorista, id]);

  const mercado = MERCADOS.find((m) => m.id === c?.mercadoId);
  const mot = c?.motorista;
  // Antes da confirmação o motorista vai até a coleta (mercado); depois, até a casa do cliente.
  const indoParaCasa = c?.status === 'em_andamento';
  const destino = indoParaCasa ? (casa ? { lat: casa.lat, lon: casa.lon } : null) : mercado ? { lat: mercado.lat, lon: mercado.lon } : null;
  const latMot = mot?.lat != null ? Math.round(mot.lat * 1e5) / 1e5 : null;
  const lonMot = mot?.lon != null ? Math.round(mot.lon * 1e5) / 1e5 : null;
  const latEta = latMot != null ? Math.round(latMot * 1e3) / 1e3 : null; // a rota só é recalculada a cada ~100 m
  const lonEta = lonMot != null ? Math.round(lonMot * 1e3) / 1e3 : null;
  const eta = useMemo(
    () => (latEta != null && lonEta != null && destino && ['aceito', 'em_andamento'].includes(c?.status ?? '') ? rotaAte({ lat: latEta, lon: lonEta }, destino) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [latEta, lonEta, destino?.lat, destino?.lon, c?.status],
  );
  // Até a casa, depois da coleta, enquanto o motorista ainda vai ao mercado.
  const etaCasaDepois = useMemo(
    () => (mercado && casa && c?.status === 'aceito' ? rotaAte({ lat: mercado.lat, lon: mercado.lon }, { lat: casa.lat, lon: casa.lon }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mercado?.id, casa?.lat, casa?.lon, c?.status],
  );

  const estadoMapa: EstadoMapa | null = useMemo(() => {
    if (!c || !casa) return null;
    return {
      modo: 'rota',
      casa: { lat: casa.lat, lon: casa.lon },
      mercados: mercado ? [{ id: mercado.id, curto: 'Coleta', lat: mercado.lat, lon: mercado.lon }] : [],
      sel: mercado?.id ?? null,
      motorista: latMot != null && lonMot != null ? { lat: latMot, lon: lonMot } : null,
      rota: eta ? { ida: eta.caminho, volta: [] } : null,
    };
  }, [c, casa, mercado, latMot, lonMot, eta]);

  async function confirmar() {
    setOcupado(true);
    try {
      setC(await api<CorridaCliente>('cliente', `/v2/corridas/${id}/confirmar-motorista`, { method: 'POST' }));
    } catch (e) {
      Alert.alert('Não foi possível', (e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  function cancelar() {
    if (!c) return;
    const comTaxa = c.status === 'no_local';
    Alert.alert(
      'Cancelar frete?',
      comTaxa
        ? `O motorista já está no local. A taxa de deslocamento de ${formatarReais(c.taxaDeslocamento)} fica com ele e o restante é devolvido.`
        : c.pagoEm
          ? 'O valor pago é devolvido para você.'
          : 'O pedido é descartado.',
      [
        { text: 'Voltar', style: 'cancel' },
        {
          text: 'Cancelar frete',
          style: 'destructive',
          onPress: () =>
            api<CorridaCliente>('cliente', `/v2/corridas/${c.id}/cancelar`, { method: 'POST' })
              .then(setC)
              .catch((e) => Alert.alert('Não foi possível cancelar', (e as Error).message)),
        },
      ],
    );
  }

  if (!c) return erro ? <Text style={[s.erro, { padding: 20 }]}>{erro}</Text> : <ActivityIndicator style={{ marginTop: 60 }} color={cores.primaria} />;

  const etapa = ETAPAS.indexOf(c.status);
  const km = (v: number) => v.toFixed(1).replace('.', ',');

  return (
    <ScrollView contentContainerStyle={s.conteudo}>
      <Stack.Screen options={{ title: c.agendado ? `Frete · ${c.janela}` : 'Seu frete' }} />

      <View style={[s.topo, c.status === 'cancelado' && { backgroundColor: cores.cartao }, c.status === 'no_local' && { backgroundColor: cores.alertaFundo }]}>
        <Text style={[s.topoTitulo, c.status === 'cancelado' && { color: cores.erro }, c.status === 'no_local' && { color: cores.alerta }]}>
          {ROTULO_STATUS[c.status]}
        </Text>
        {eta && c.status === 'aceito' && (
          <Text style={s.eta}>
            Chega à coleta em <Text style={s.etaForte}>~{eta.min} min</Text> ({km(eta.km)} km)
            {etaCasaDepois ? `\nDepois, ~${etaCasaDepois.min} min até sua casa` : ''}
          </Text>
        )}
        {eta && c.status === 'em_andamento' && (
          <Text style={s.eta}>
            Chega na sua casa em <Text style={s.etaForte}>~{eta.min} min</Text> ({km(eta.km)} km)
          </Text>
        )}
        {c.status === 'pagamento_pendente' && <Text style={s.eta}>Finalize o pagamento para chamar o motorista.</Text>}
        {c.status === 'buscando' && (
          <Text style={s.eta}>
            {c.agendado ? `Agendado para ${c.janela}. Avisamos quando um motorista aceitar.` : 'Avisando os motoristas próximos…'}
            {'\n'}🔒 Seu pagamento está retido com segurança.
          </Text>
        )}
        {c.status === 'cancelado' && (
          <Text style={s.eta}>
            {c.motivo === 'sem_motorista' ? 'Nenhum motorista aceitou a tempo.' : c.motivo === 'nao_pago' ? 'O pagamento não foi concluído.' : 'Frete cancelado.'}
            {c.reembolso > 0 ? ` ${formatarReais(c.reembolso)} ${c.reembolsadoEm ? 'devolvidos' : 'serão devolvidos'} para você.` : ''}
          </Text>
        )}
        {c.status !== 'cancelado' && c.status !== 'pagamento_pendente' && (
          <View style={s.etapas}>
            {ETAPAS.map((e, i) => (
              <View key={e} style={[s.etapa, i <= etapa && s.etapaFeita]} />
            ))}
          </View>
        )}
      </View>

      {c.status === 'pagamento_pendente' && (
        <Pressable style={s.botao} onPress={() => router.push(`/checkout/${c.id}`)}>
          <Text style={s.botaoTexto}>Pagar {formatarReais(c.valor)}</Text>
        </Pressable>
      )}

      {c.status === 'no_local' && (
        <View style={s.confirmar}>
          <Text style={s.confirmarTitulo}>O motorista chegou ao {c.mercadoNome}?</Text>
          <Text style={s.confirmarTexto}>Confira a foto, o carro e a placa abaixo. Ao confirmar, o pagamento é liberado para ele e o frete começa.</Text>
          <Pressable style={[s.botao, { backgroundColor: cores.alerta }]} onPress={confirmar} disabled={ocupado}>
            {ocupado ? <ActivityIndicator color="#fff" /> : <Text style={s.botaoTexto}>Sim, o motorista está aqui</Text>}
          </Pressable>
        </View>
      )}

      {estadoMapa && ['aceito', 'no_local', 'em_andamento'].includes(c.status) && <MapaRuas estado={estadoMapa} style={{ height: 320 }} />}

      {mot && c.status !== 'cancelado' && (
        <View style={s.motorista}>
          {foto ? <Image source={foto} style={s.foto} /> : <View style={[s.foto, s.fotoVazia]}><Text style={{ fontSize: 26 }}>🙂</Text></View>}
          <View style={{ flex: 1 }}>
            <Text style={s.motNome}>{mot.nome}</Text>
            <Text style={s.motCarro}>
              {mot.carro}
              {mot.cor ? ` · ${mot.cor}` : ''}
            </Text>
            <Text style={s.placa}>{mot.placa}</Text>
          </View>
          <Pressable style={s.chat} onPress={() => router.push(`/chat/${c.id}`)}>
            <Text style={s.chatTexto}>💬 Chat</Text>
          </Pressable>
        </View>
      )}

      <View style={s.resumo}>
        <Linha a="Coleta" b={c.mercadoNome} />
        <Linha a="Quando" b={c.agendado ? c.janela : 'Agora'} />
        <Linha a="Frete" b={formatarReais(c.valor)} />
        {c.pagoEm ? (
          <Linha a="Pagamento" b={`${c.metodo === 'pix' ? 'Pix' : 'Cartão'} · ${c.liberadoEm ? 'liberado ao motorista' : c.status === 'cancelado' ? 'devolução' : 'retido'}`} />
        ) : null}
      </View>
      {c.receiptUrl && (
        <Pressable onPress={() => WebBrowser.openBrowserAsync(c.receiptUrl!)}>
          <Text style={s.link}>Ver comprovante</Text>
        </Pressable>
      )}
      {['pagamento_pendente', 'buscando', 'aceito', 'no_local'].includes(c.status) && (
        <Pressable onPress={cancelar}>
          <Text style={[s.link, { color: cores.erro }]}>Cancelar frete</Text>
        </Pressable>
      )}
      {erro && <Text style={s.erro}>{erro}</Text>}
    </ScrollView>
  );
}

function Linha({ a, b }: { a: string; b: string }) {
  return (
    <View style={s.linha}>
      <Text style={s.linhaA}>{a}</Text>
      <Text style={s.linhaB}>{b}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  conteudo: { padding: 16, paddingBottom: 40, gap: 12 },
  topo: { backgroundColor: cores.primariaClara, borderRadius: raio, padding: 16, gap: 4 },
  topoTitulo: { fontSize: 20, fontWeight: '800', color: cores.primaria },
  eta: { fontSize: 15, color: cores.texto },
  etaForte: { fontWeight: '800', fontSize: 17 },
  etapas: { flexDirection: 'row', gap: 6, marginTop: 10 },
  etapa: { flex: 1, height: 6, borderRadius: 3, backgroundColor: cores.borda },
  etapaFeita: { backgroundColor: cores.primaria },
  confirmar: { backgroundColor: cores.cartao, borderWidth: 2, borderColor: cores.alerta, borderRadius: raio, padding: 14, gap: 8 },
  confirmarTitulo: { fontSize: 17, fontWeight: '800', color: cores.texto },
  confirmarTexto: { fontSize: 14, color: cores.suave },
  motorista: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: cores.cartao, borderRadius: raio, borderWidth: 1, borderColor: cores.borda, padding: 12 },
  foto: { width: 64, height: 64, borderRadius: 32 },
  fotoVazia: { backgroundColor: cores.fundo, alignItems: 'center', justifyContent: 'center' },
  motNome: { fontSize: 17, fontWeight: '800', color: cores.texto },
  motCarro: { fontSize: 14, color: cores.suave },
  placa: { alignSelf: 'flex-start', marginTop: 4, fontSize: 15, fontWeight: '800', letterSpacing: 1, borderWidth: 1, borderColor: cores.texto, borderRadius: 4, paddingHorizontal: 6 },
  chat: { backgroundColor: cores.primaria, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12 },
  chatTexto: { color: '#fff', fontWeight: '700' },
  resumo: { backgroundColor: cores.cartao, borderRadius: raio, borderWidth: 1, borderColor: cores.borda, padding: 12, gap: 6 },
  linha: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  linhaA: { color: cores.suave, fontSize: 14 },
  linhaB: { color: cores.texto, fontSize: 14, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  botao: { backgroundColor: cores.primaria, borderRadius: raio, paddingVertical: 16, alignItems: 'center' },
  botaoTexto: { color: '#fff', fontSize: 17, fontWeight: '800' },
  link: { color: cores.primaria, fontWeight: '700', fontSize: 15, textAlign: 'center', paddingVertical: 8 },
  erro: { color: cores.erro, fontSize: 13 },
});
