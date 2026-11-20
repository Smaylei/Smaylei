import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import MapaRuas, { type EstadoMapa } from '../../components/MapaRuas';
import { cores, raio } from '../../components/tema';
import { api, ROTULO_STATUS, type CorridaMotorista } from '../../services/api';
import { rotaAte } from '../../services/eta';
import { enviarPosicao, posicaoAtual } from '../../services/localizacao';
import { formatarReais } from '../../services/preco';

const ATUALIZAR_MS = 4000;
const ATIVA = ['aceito', 'no_local', 'em_andamento'];

/** Abre o Google Maps (ou o app de mapas do celular) já navegando até o destino. */
function navegar(lat: number, lon: number) {
  Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=driving&dir_action=navigate`);
}

export default function CorridaMotoristaTela() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [c, setC] = useState<CorridaMotorista | null>(null);
  const [eu, setEu] = useState<{ lat: number; lon: number } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [agora, setAgora] = useState(0);

  const carregar = useCallback(async () => {
    try {
      setC(await api<CorridaMotorista>('motorista', `/v2/corridas/${id}`));
      setAgora(Date.now());
    } catch (e) {
      Alert.alert('Erro', (e as Error).message);
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

  // Durante a corrida, a posição vai ao servidor a cada poucos segundos (o cliente vê o carro andar).
  const ativa = !!c && ATIVA.includes(c.status);
  useEffect(() => {
    if (!ativa) return;
    let sub: Location.LocationSubscription | null = null;
    Location.watchPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: 3000, distanceInterval: 8 }, (p) => {
      const pos = { lat: p.coords.latitude, lon: p.coords.longitude };
      setEu({ lat: Math.round(pos.lat * 1e5) / 1e5, lon: Math.round(pos.lon * 1e5) / 1e5 });
      enviarPosicao(pos.lat, pos.lon).catch(() => {});
    })
      .then((s) => (sub = s))
      .catch(() => {});
    return () => sub?.remove();
  }, [ativa]);

  // Navegação automática: ao aceitar → até a coleta; quando o cliente confirma → até a entrega.
  const fase = c?.status === 'aceito' ? 'coleta' : c?.status === 'em_andamento' ? 'entrega' : null;
  useEffect(() => {
    if (!c || !fase) return;
    const chave = `nav:${c.id}:${fase}`;
    AsyncStorage.getItem(chave).then((ja) => {
      if (ja) return;
      AsyncStorage.setItem(chave, '1');
      const alvo = fase === 'coleta' ? c.mercado : c.cliente;
      if (alvo) navegar(alvo.lat, alvo.lon);
    });
  }, [c, fase]);

  const indoAoCliente = c?.status === 'em_andamento';
  const destino = c ? (indoAoCliente ? c.cliente : c.mercado) : null;
  const latEta = eu ? Math.round(eu.lat * 1e3) / 1e3 : null;
  const lonEta = eu ? Math.round(eu.lon * 1e3) / 1e3 : null;
  const eta = useMemo(
    () => (latEta != null && lonEta != null && destino ? rotaAte({ lat: latEta, lon: lonEta }, { lat: destino.lat, lon: destino.lon }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [latEta, lonEta, destino?.lat, destino?.lon],
  );
  const estadoMapa: EstadoMapa | null = useMemo(
    () =>
      c?.cliente && c.mercado
        ? {
            modo: 'rota',
            casa: { lat: c.cliente.lat, lon: c.cliente.lon },
            mercados: [{ id: c.mercado.id, curto: 'Coleta', lat: c.mercado.lat, lon: c.mercado.lon }],
            sel: c.mercado.id,
            motorista: eu,
            rota: eta ? { ida: eta.caminho, volta: [] } : null,
          }
        : null,
    [c, eu, eta],
  );

  async function acao(caminho: string, opts: { confirmar?: string; corpo?: unknown } = {}) {
    const executar = async () => {
      setOcupado(true);
      try {
        await api('motorista', `/v2/corridas/${id}/${caminho}`, { method: 'POST', corpo: opts.corpo });
        await carregar();
        if (caminho === 'desistir' || caminho === 'cliente-ausente') router.back();
      } catch (e) {
        Alert.alert('Não foi possível', (e as Error).message);
      } finally {
        setOcupado(false);
      }
    };
    if (opts.confirmar) Alert.alert('Confirmar', opts.confirmar, [{ text: 'Voltar', style: 'cancel' }, { text: 'Confirmar', onPress: executar }]);
    else executar();
  }

  async function cheguei() {
    setOcupado(true);
    try {
      const p = await posicaoAtual();
      await api('motorista', `/v2/corridas/${id}/cheguei`, { method: 'POST', corpo: p });
      await carregar();
    } catch (e) {
      Alert.alert('Não foi possível', (e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  if (!c) return <ActivityIndicator style={{ marginTop: 60 }} color={cores.primaria} />;
  const esperando = c.status === 'no_local' && c.chegouEm ? Math.floor((agora - Date.parse(c.chegouEm)) / 60000) : 0;
  const km = (v: number) => v.toFixed(1).replace('.', ',');

  return (
    <ScrollView contentContainerStyle={s.conteudo}>
      <Stack.Screen options={{ title: c.agendado ? `Corrida · ${c.janela}` : 'Corrida agora' }} />
      <View style={s.topo}>
        <Text style={s.topoTitulo}>{ROTULO_STATUS[c.status]}</Text>
        {eta && ['aceito', 'em_andamento'].includes(c.status) && (
          <Text style={s.eta}>
            {indoAoCliente ? 'Até a entrega' : 'Até a coleta'}: <Text style={{ fontWeight: '800' }}>~{eta.min} min</Text> · {km(eta.km)} km
          </Text>
        )}
        <Text style={s.ganho}>
          Ganho: {formatarReais(c.ganho)} {c.liberadoEm ? '· liberado no seu saldo' : '· liberado quando o cliente confirmar sua chegada'}
        </Text>
      </View>

      {estadoMapa && <MapaRuas estado={estadoMapa} style={{ height: 300 }} />}

      {destino && ATIVA.includes(c.status) && (
        <Pressable style={[s.botao, s.botaoNav]} onPress={() => navegar(destino.lat, destino.lon)}>
          <Text style={s.botaoTexto}>🧭 Navegar até {indoAoCliente ? 'a entrega' : 'a coleta'}</Text>
        </Pressable>
      )}

      <View style={s.bloco}>
        <Text style={s.rotulo}>COLETA</Text>
        <Text style={s.texto}>🛒 {c.mercado?.nome}</Text>
        <Text style={s.detalhe}>{c.mercado?.endereco}</Text>
      </View>
      <View style={s.bloco}>
        <Text style={s.rotulo}>ENTREGA</Text>
        <Text style={s.texto}>👤 {c.cliente?.nome}</Text>
        <Text style={s.detalhe}>{c.cliente?.endereco}</Text>
        <View style={{ flexDirection: 'row', gap: 16, flexWrap: 'wrap' }}>
          <Pressable onPress={() => router.push(`/chat/${c.id}`)}>
            <Text style={s.link}>💬 Chat com o cliente</Text>
          </Pressable>
        </View>
      </View>

      {c.status === 'aceito' && (
        <>
          <Pressable style={s.botao} onPress={cheguei} disabled={ocupado}>
            {ocupado ? <ActivityIndicator color="#fff" /> : <Text style={s.botaoTexto}>Cheguei ao local da coleta</Text>}
          </Pressable>
          <Text style={s.ajuda}>Funciona a até {c.raioChegadaM} m do mercado (confere pelo GPS). O cliente recebe o aviso para confirmar.</Text>
          <Pressable onPress={() => acao('desistir', { confirmar: 'A corrida volta a procurar outro motorista.' })}>
            <Text style={[s.link, { color: cores.erro, textAlign: 'center' }]}>Desistir da corrida</Text>
          </Pressable>
        </>
      )}
      {c.status === 'no_local' && (
        <View style={s.esperando}>
          <Text style={s.esperandoTitulo}>Aguardando o cliente confirmar sua chegada…</Text>
          <Text style={s.detalhe}>Esperando há {esperando} min. O valor é liberado no seu saldo assim que ele confirmar.</Text>
          <Pressable
            style={[s.botao, s.botaoSec, esperando < c.esperaConfirmacaoMin && { opacity: 0.4 }]}
            disabled={esperando < c.esperaConfirmacaoMin || ocupado}
            onPress={() => acao('cliente-ausente', { confirmar: `Encerrar porque o cliente não apareceu? Você recebe a taxa de deslocamento (${formatarReais(c.taxaDeslocamento)}).` })}
          >
            <Text style={[s.botaoTexto, { color: cores.erro }]}>Cliente não apareceu</Text>
          </Pressable>
          {esperando < c.esperaConfirmacaoMin && <Text style={s.ajuda}>Disponível após {c.esperaConfirmacaoMin} min de espera.</Text>}
        </View>
      )}
      {c.status === 'em_andamento' && (
        <>
          <Text style={s.pago}>✓ Cliente confirmou. Valor liberado no seu saldo. Leve as compras até a entrega.</Text>
          <Pressable style={s.botao} onPress={() => acao('entregue')} disabled={ocupado}>
            {ocupado ? <ActivityIndicator color="#fff" /> : <Text style={s.botaoTexto}>Concluir entrega</Text>}
          </Pressable>
        </>
      )}
      {c.status === 'entregue' && <Text style={s.pago}>✓ Entregue. Bom trabalho!</Text>}
      {c.status === 'cancelado' && <Text style={[s.pago, { color: cores.erro }]}>Corrida cancelada.</Text>}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  conteudo: { padding: 16, paddingBottom: 40, gap: 12 },
  topo: { backgroundColor: cores.primariaClara, borderRadius: raio, padding: 16, gap: 4 },
  topoTitulo: { fontSize: 19, fontWeight: '800', color: cores.primaria },
  eta: { fontSize: 15, color: cores.texto },
  ganho: { fontSize: 14, color: cores.texto },
  bloco: { backgroundColor: cores.cartao, borderRadius: raio, borderWidth: 1, borderColor: cores.borda, padding: 12, gap: 2 },
  rotulo: { fontSize: 11, fontWeight: '800', color: cores.suave, letterSpacing: 0.5 },
  texto: { fontSize: 16, fontWeight: '600', color: cores.texto },
  detalhe: { fontSize: 14, color: cores.suave },
  link: { color: cores.primaria, fontWeight: '700', fontSize: 15, paddingVertical: 6 },
  botao: { backgroundColor: cores.primaria, borderRadius: raio, paddingVertical: 17, alignItems: 'center' },
  botaoNav: { backgroundColor: '#1F4FA8' },
  botaoSec: { backgroundColor: cores.cartao, borderWidth: 1, borderColor: cores.erro },
  botaoTexto: { color: '#fff', fontSize: 17, fontWeight: '800' },
  ajuda: { fontSize: 12, color: cores.suave, textAlign: 'center' },
  esperando: { backgroundColor: cores.alertaFundo, borderRadius: raio, padding: 14, gap: 8 },
  esperandoTitulo: { fontSize: 17, fontWeight: '800', color: cores.alerta },
  pago: { fontSize: 16, fontWeight: '700', color: cores.primaria, textAlign: 'center' },
});
