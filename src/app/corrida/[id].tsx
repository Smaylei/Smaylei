import * as Linking from 'expo-linking';
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

const ATUALIZAR_MS = 5000;
const ETAPAS: CorridaCliente['status'][] = ['buscando', 'aceito', 'aguardando_pagamento', 'pago', 'entregue'];

export default function Corrida() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { casa } = useApp();
  const [c, setC] = useState<CorridaCliente | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [foto, setFoto] = useState<{ uri: string; headers?: Record<string, string> } | null>(null);
  const [agora, setAgora] = useState(0);

  const carregar = useCallback(async () => {
    try {
      setC(await api<CorridaCliente>('cliente', `/v2/corridas/${id}`));
      setAgora(Date.now());
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
  // Destino do motorista: o mercado (até pagar) e depois a casa do cliente.
  const destino = c?.status === 'pago' ? (casa ? { lat: casa.lat, lon: casa.lon } : null) : mercado ? { lat: mercado.lat, lon: mercado.lon } : null;
  const latMot = mot?.lat != null ? Math.round(mot.lat * 1e4) / 1e4 : null;
  const lonMot = mot?.lon != null ? Math.round(mot.lon * 1e4) / 1e4 : null;
  const eta = useMemo(
    () => (latMot != null && lonMot != null && destino && ['aceito', 'pago'].includes(c?.status ?? '') ? rotaAte({ lat: latMot, lon: lonMot }, destino) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [latMot, lonMot, destino?.lat, destino?.lon, c?.status],
  );

  const estadoMapa: EstadoMapa | null = useMemo(() => {
    if (!c || !casa) return null;
    return {
      modo: 'rota',
      casa: { lat: casa.lat, lon: casa.lon },
      mercados: mercado ? [{ id: mercado.id, curto: mercado.nome.split(' ')[0], lat: mercado.lat, lon: mercado.lon }] : [],
      sel: mercado?.id ?? null,
      motorista: latMot != null && lonMot != null ? { lat: latMot, lon: lonMot } : null,
      rota: eta ? { ida: eta.caminho, volta: [] } : null,
    };
  }, [c, casa, mercado, latMot, lonMot, eta]);

  async function pagar() {
    if (!c?.checkoutUrl) return;
    await WebBrowser.openAuthSessionAsync(c.checkoutUrl, Linking.createURL('pagamento'));
    carregar();
  }

  function cancelar() {
    if (!c) return;
    const comTaxa = c.status === 'aguardando_pagamento';
    Alert.alert(
      'Cancelar frete?',
      comTaxa ? 'O motorista já está no mercado. Será cobrada a taxa de deslocamento no seu próximo frete.' : 'O horário fica livre para outra pessoa.',
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
  const restante = c.status === 'aguardando_pagamento' && c.chegouEm ? Math.max(0, Math.ceil((Date.parse(c.chegouEm) + c.esperaPagamentoMin * 60000 - agora) / 60000)) : null;

  return (
    <ScrollView contentContainerStyle={s.conteudo}>
      <Stack.Screen options={{ title: c.agendado ? `Frete · ${c.janela}` : 'Seu frete' }} />

      <View style={[s.topo, c.status === 'cancelado' && { backgroundColor: cores.cartao }, c.status === 'aguardando_pagamento' && { backgroundColor: cores.alertaFundo }]}>
        <Text style={[s.topoTitulo, c.status === 'cancelado' && { color: cores.erro }, c.status === 'aguardando_pagamento' && { color: cores.alerta }]}>
          {ROTULO_STATUS[c.status]}
        </Text>
        {eta && c.status === 'aceito' && <Text style={s.eta}>Chega ao mercado em ~{eta.min} min ({eta.km.toFixed(1).replace('.', ',')} km)</Text>}
        {eta && c.status === 'pago' && <Text style={s.eta}>Chega na sua casa em ~{eta.min} min ({eta.km.toFixed(1).replace('.', ',')} km)</Text>}
        {c.status === 'buscando' && <Text style={s.eta}>{c.agendado ? `Agendado para ${c.janela}. Avisamos quando um motorista aceitar.` : 'Avisando os motoristas próximos…'}</Text>}
        {c.status === 'cancelado' && (
          <Text style={s.eta}>
            {c.motivo === 'sem_motorista' ? 'Nenhum motorista aceitou a tempo.' : c.motivo === 'nao_pagou' ? 'O pagamento não foi feito no prazo.' : 'Frete cancelado.'}
            {c.taxaAplicada > 0 ? ` Taxa de deslocamento de ${formatarReais(c.taxaAplicada)} no próximo frete.` : ''}
          </Text>
        )}
        {c.status !== 'cancelado' && (
          <View style={s.etapas}>
            {ETAPAS.map((e, i) => (
              <View key={e} style={[s.etapa, i <= etapa && s.etapaFeita]} />
            ))}
          </View>
        )}
      </View>

      {c.status === 'aguardando_pagamento' && (
        <View style={s.pagar}>
          <Text style={s.pagarTexto}>O motorista chegou ao {c.mercadoNome}. Pague para ele pegar suas compras.</Text>
          <Pressable style={[s.botao, { backgroundColor: cores.alerta }]} onPress={pagar}>
            <Text style={s.botaoTexto}>Pagar {formatarReais(c.valorCobrado)}</Text>
          </Pressable>
          {restante !== null && <Text style={s.pagarPrazo}>Prazo: {restante} min. Depois disso o frete é cancelado com taxa de deslocamento.</Text>}
          {c.taxaIncluida > 0 && <Text style={s.pagarPrazo}>Inclui {formatarReais(c.taxaIncluida)} de taxa de deslocamento pendente.</Text>}
        </View>
      )}

      {estadoMapa && ['aceito', 'aguardando_pagamento', 'pago'].includes(c.status) && <MapaRuas estado={estadoMapa} style={{ height: 300 }} />}

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
        <Linha a="Mercado" b={c.mercadoNome} />
        <Linha a="Quando" b={c.agendado ? c.janela : 'Agora'} />
        <Linha a="Frete" b={formatarReais(c.valor)} />
        {c.status === 'pago' || c.status === 'entregue' ? <Linha a="Pago" b={`${formatarReais(c.valorCobrado)} · ${c.metodo === 'pix' ? 'Pix' : 'cartão'}`} /> : null}
      </View>
      {c.receiptUrl && (
        <Pressable onPress={() => WebBrowser.openBrowserAsync(c.receiptUrl!)}>
          <Text style={s.link}>Ver comprovante</Text>
        </Pressable>
      )}
      {['buscando', 'aceito', 'aguardando_pagamento'].includes(c.status) && (
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
  etapas: { flexDirection: 'row', gap: 6, marginTop: 10 },
  etapa: { flex: 1, height: 6, borderRadius: 3, backgroundColor: cores.borda },
  etapaFeita: { backgroundColor: cores.primaria },
  pagar: { backgroundColor: cores.cartao, borderWidth: 2, borderColor: cores.alerta, borderRadius: raio, padding: 14, gap: 8 },
  pagarTexto: { fontSize: 15, color: cores.texto, fontWeight: '600' },
  pagarPrazo: { fontSize: 12, color: cores.suave },
  motorista: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: cores.cartao, borderRadius: raio, borderWidth: 1, borderColor: cores.borda, padding: 12 },
  foto: { width: 60, height: 60, borderRadius: 30 },
  fotoVazia: { backgroundColor: cores.fundo, alignItems: 'center', justifyContent: 'center' },
  motNome: { fontSize: 17, fontWeight: '800', color: cores.texto },
  motCarro: { fontSize: 14, color: cores.suave },
  placa: { alignSelf: 'flex-start', marginTop: 4, fontSize: 14, fontWeight: '800', letterSpacing: 1, borderWidth: 1, borderColor: cores.texto, borderRadius: 4, paddingHorizontal: 6 },
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
