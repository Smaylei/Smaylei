import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import MapaRuas, { type EstadoMapa } from '../../components/MapaRuas';
import { cores, raio } from '../../components/tema';
import { api, ROTULO_STATUS, type CorridaMotorista } from '../../services/api';
import { rotaAte } from '../../services/eta';
import { posicaoAtual } from '../../services/localizacao';
import { formatarReais } from '../../services/preco';

const ATUALIZAR_MS = 5000;
const soDigitos = (t: string) => t.replace(/\D/g, '');

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
      const p = await posicaoAtual().catch(() => null);
      if (p) setEu({ lat: Math.round(p.lat * 1e4) / 1e4, lon: Math.round(p.lon * 1e4) / 1e4 });
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

  const indoAoCliente = c?.status === 'pago';
  const destino = c ? (indoAoCliente ? c.cliente : c.mercado) : null;
  const eta = useMemo(
    () => (eu && destino ? rotaAte(eu, { lat: destino.lat, lon: destino.lon }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [eu?.lat, eu?.lon, destino?.lat, destino?.lon],
  );
  const estadoMapa: EstadoMapa | null = useMemo(
    () =>
      c?.cliente && c.mercado
        ? {
            modo: 'rota',
            casa: { lat: c.cliente.lat, lon: c.cliente.lon },
            mercados: [{ id: c.mercado.id, curto: c.mercado.nome.split(' ')[0], lat: c.mercado.lat, lon: c.mercado.lon }],
            sel: c.mercado.id,
            motorista: eu,
            rota: eta ? { ida: eta.caminho, volta: [] } : null,
          }
        : null,
    [c, eu, eta],
  );

  async function acao(caminho: string, confirmar?: string) {
    const executar = async () => {
      setOcupado(true);
      try {
        await api('motorista', `/v2/corridas/${id}/${caminho}`, { method: 'POST' });
        await carregar();
        if (caminho === 'desistir' || caminho === 'nao-pagou') router.back();
      } catch (e) {
        Alert.alert('Não foi possível', (e as Error).message);
      } finally {
        setOcupado(false);
      }
    };
    if (confirmar) Alert.alert('Confirmar', confirmar, [{ text: 'Voltar', style: 'cancel' }, { text: 'Confirmar', style: 'destructive', onPress: executar }]);
    else executar();
  }

  function navegar(lat: number, lon: number) {
    Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=driving`);
  }

  if (!c) return <ActivityIndicator style={{ marginTop: 60 }} color={cores.primaria} />;
  const esperando = c.status === 'aguardando_pagamento' && c.chegouEm ? Math.floor((agora - Date.parse(c.chegouEm)) / 60000) : null;
  const tel = c.cliente?.telefone ? soDigitos(c.cliente.telefone) : '';

  return (
    <ScrollView contentContainerStyle={s.conteudo}>
      <Stack.Screen options={{ title: c.agendado ? `Corrida · ${c.janela}` : 'Corrida agora' }} />
      <View style={s.topo}>
        <Text style={s.topoTitulo}>{ROTULO_STATUS[c.status]}</Text>
        {eta && ['aceito', 'pago'].includes(c.status) && (
          <Text style={s.eta}>
            {indoAoCliente ? 'Até o cliente' : 'Até o mercado'}: ~{eta.min} min · {eta.km.toFixed(1).replace('.', ',')} km
          </Text>
        )}
        <Text style={s.ganho}>Ganho: {formatarReais(c.ganho)}</Text>
      </View>

      {estadoMapa && <MapaRuas estado={estadoMapa} style={{ height: 280 }} />}

      <View style={s.bloco}>
        <Text style={s.rotulo}>COLETA</Text>
        <Text style={s.texto}>🛒 {c.mercado?.nome}</Text>
        <Text style={s.detalhe}>{c.mercado?.endereco}</Text>
        {c.mercado && (
          <Pressable onPress={() => navegar(c.mercado!.lat, c.mercado!.lon)}>
            <Text style={s.link}>Navegar até o mercado ›</Text>
          </Pressable>
        )}
      </View>
      <View style={s.bloco}>
        <Text style={s.rotulo}>ENTREGA</Text>
        <Text style={s.texto}>👤 {c.cliente?.nome}</Text>
        <Text style={s.detalhe}>{c.cliente?.endereco}</Text>
        <View style={{ flexDirection: 'row', gap: 16, flexWrap: 'wrap' }}>
          {c.cliente && (
            <Pressable onPress={() => navegar(c.cliente!.lat, c.cliente!.lon)}>
              <Text style={s.link}>Navegar até o cliente ›</Text>
            </Pressable>
          )}
          <Pressable onPress={() => router.push(`/chat/${c.id}`)}>
            <Text style={s.link}>💬 Chat</Text>
          </Pressable>
          {!!tel && (
            <Pressable onPress={() => Linking.openURL(`https://wa.me/${tel.startsWith('55') ? tel : `55${tel}`}`)}>
              <Text style={s.link}>WhatsApp</Text>
            </Pressable>
          )}
        </View>
      </View>

      {c.status === 'aceito' && (
        <>
          <Pressable style={s.botao} onPress={() => acao('cheguei')} disabled={ocupado}>
            {ocupado ? <ActivityIndicator color="#fff" /> : <Text style={s.botaoTexto}>Cheguei ao mercado</Text>}
          </Pressable>
          <Text style={s.ajuda}>Ao tocar, o cliente recebe o pedido de pagamento. Pegue as compras só depois de pago.</Text>
          <Pressable onPress={() => acao('desistir', 'A corrida volta a procurar outro motorista.')}>
            <Text style={[s.link, { color: cores.erro, textAlign: 'center' }]}>Desistir da corrida</Text>
          </Pressable>
        </>
      )}
      {c.status === 'aguardando_pagamento' && (
        <View style={s.esperando}>
          <Text style={s.esperandoTitulo}>Aguardando o cliente pagar…</Text>
          <Text style={s.detalhe}>Esperando há {esperando ?? 0} min. Não pegue as compras antes do pagamento.</Text>
          <Pressable
            style={[s.botao, s.botaoSec, (esperando ?? 0) < 5 && { opacity: 0.4 }]}
            disabled={(esperando ?? 0) < 5 || ocupado}
            onPress={() => acao('nao-pagou', 'Cancelar porque o cliente não pagou? Ele paga a taxa de deslocamento na próxima.')}
          >
            <Text style={[s.botaoTexto, { color: cores.erro }]}>Cliente não pagou</Text>
          </Pressable>
          {(esperando ?? 0) < 5 && <Text style={s.ajuda}>Disponível após 5 min de espera.</Text>}
        </View>
      )}
      {c.status === 'pago' && (
        <>
          <Text style={s.pago}>✓ Pago. Pegue as compras e leve até o cliente.</Text>
          <Pressable style={s.botao} onPress={() => acao('entregue', 'Confirmar que entregou as compras?')} disabled={ocupado}>
            <Text style={s.botaoTexto}>Entregue</Text>
          </Pressable>
        </>
      )}
      {c.status === 'entregue' && <Text style={s.pago}>✓ Entregue. Bom trabalho!</Text>}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  conteudo: { padding: 16, paddingBottom: 40, gap: 12 },
  topo: { backgroundColor: cores.primariaClara, borderRadius: raio, padding: 16, gap: 4 },
  topoTitulo: { fontSize: 19, fontWeight: '800', color: cores.primaria },
  eta: { fontSize: 15, color: cores.texto },
  ganho: { fontSize: 15, fontWeight: '700', color: cores.texto },
  bloco: { backgroundColor: cores.cartao, borderRadius: raio, borderWidth: 1, borderColor: cores.borda, padding: 12, gap: 2 },
  rotulo: { fontSize: 11, fontWeight: '800', color: cores.suave, letterSpacing: 0.5 },
  texto: { fontSize: 16, fontWeight: '600', color: cores.texto },
  detalhe: { fontSize: 14, color: cores.suave },
  link: { color: cores.primaria, fontWeight: '700', fontSize: 15, paddingVertical: 6 },
  botao: { backgroundColor: cores.primaria, borderRadius: raio, paddingVertical: 17, alignItems: 'center' },
  botaoSec: { backgroundColor: cores.cartao, borderWidth: 1, borderColor: cores.erro },
  botaoTexto: { color: '#fff', fontSize: 17, fontWeight: '800' },
  ajuda: { fontSize: 12, color: cores.suave, textAlign: 'center' },
  esperando: { backgroundColor: cores.alertaFundo, borderRadius: raio, padding: 14, gap: 8 },
  esperandoTitulo: { fontSize: 17, fontWeight: '800', color: cores.alerta },
  pago: { fontSize: 16, fontWeight: '700', color: cores.primaria, textAlign: 'center' },
});
