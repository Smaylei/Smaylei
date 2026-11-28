import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import AvaliarFrete from '../../components/AvaliarFrete';
import MapaRuas, { type EstadoMapa } from '../../components/MapaRuas';
import { cores, raio, sombra } from '../../components/tema';
import { useApp, usePreco } from '../../estado/AppContext';
import { irParaPagamento } from '../../services/pagamento';
import { api, fonteImagem, ROTULO_STATUS, type CorridaCliente } from '../../services/api';
import { useRota } from '../../services/eta';
import { SOLICITANTE } from '../../variante';
import { formatarReais } from '../../services/preco';

const ATUALIZAR_MS = 3000; // o carro anda no mapa a cada atualização
const ETAPAS: CorridaCliente['status'][] = ['buscando', 'aceito', 'no_local', 'em_andamento', 'entregue'];

export default function Corrida() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { casa, config } = useApp();
  const preco = usePreco();
  const [c, setC] = useState<CorridaCliente | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [foto, setFoto] = useState<{ uri: string; headers?: Record<string, string> } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setC(await api<CorridaCliente>(SOLICITANTE, `/v2/corridas/${id}`));
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
    if (temMotorista) fonteImagem(SOLICITANTE, `/v2/corridas/${id}/foto-motorista`).then(setFoto);
  }, [temMotorista, id]);

  // Coleta e destino da viagem (versões antigas do servidor: mercado → casa).
  const coleta = c?.coleta ?? null;
  const entregaServidor = c?.entrega;
  const entrega = useMemo(
    () => entregaServidor ?? (casa ? { nome: 'Casa', endereco: casa.endereco, lat: casa.lat, lon: casa.lon } : null),
    [entregaServidor, casa],
  );
  const mot = c?.motorista;
  // Antes da coleta o motorista vai até lá; depois, até o destino.
  const indoParaCasa = c?.status === 'em_andamento';
  const destino = indoParaCasa ? entrega : coleta;
  const latMot = mot?.lat != null ? Math.round(mot.lat * 1e5) / 1e5 : null;
  const lonMot = mot?.lon != null ? Math.round(mot.lon * 1e5) / 1e5 : null;
  // Rota de carro (OSRM pelo servidor), recalculada a cada ~100 m do motorista.
  const eta = useRota(latMot != null && lonMot != null ? { lat: latMot, lon: lonMot } : null, destino, ['aceito', 'em_andamento'].includes(c?.status ?? ''));
  // Da coleta até o destino, enquanto o motorista ainda vai à coleta.
  const etaCasaDepois = useRota(coleta, entrega, c?.status === 'aceito');

  const estadoMapa: EstadoMapa | null = useMemo(() => {
    if (!c || !entrega) return null;
    return {
      modo: 'rota',
      casa: { lat: entrega.lat, lon: entrega.lon },
      mercados: coleta ? [{ id: 'coleta', curto: 'Coleta', lat: coleta.lat, lon: coleta.lon }] : [],
      sel: coleta ? 'coleta' : null,
      motorista: latMot != null && lonMot != null ? { lat: latMot, lon: lonMot, moto: c.veiculo === 'moto' } : null,
      rota: eta ? { ida: eta.caminho, volta: [] } : null,
    };
  }, [c, coleta, entrega, latMot, lonMot, eta]);

  async function confirmarRecebimento() {
    setOcupado(true);
    try {
      setC(await api<CorridaCliente>(SOLICITANTE, `/v2/corridas/${id}/confirmar-recebimento`, { method: 'POST' }));
    } catch (e) {
      Alert.alert('Não foi possível', (e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function confirmar() {
    setOcupado(true);
    try {
      setC(await api<CorridaCliente>(SOLICITANTE, `/v2/corridas/${id}/confirmar-motorista`, { method: 'POST' }));
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
            api<CorridaCliente>(SOLICITANTE, `/v2/corridas/${c.id}/cancelar`, { method: 'POST' })
              .then(setC)
              .catch((e) => Alert.alert('Não foi possível cancelar', (e as Error).message)),
        },
      ],
    );
  }

  if (!c) return erro ? <Text style={[s.erro, { padding: 20 }]}>{erro}</Text> : <ActivityIndicator style={{ marginTop: 60 }} color={cores.primaria} />;

  const etapa = ETAPAS.indexOf(c.status);
  const naColeta = c.clienteNaColeta !== false;
  const km = (v: number) => v.toFixed(1).replace('.', ',');

  const nomeDestino = entrega?.nome === 'Casa' ? 'sua casa' : (entrega?.nome ?? 'o destino');
  const titulo = c.aguardandoPagamento
    ? `${c.motorista?.nome ?? 'O motorista'} aceitou! Pague para ele sair`
    : !naColeta && c.status === 'no_local'
      ? 'Motorista retirando na coleta'
      : !naColeta && c.status === 'em_andamento'
        ? c.chegouDestinoEm
          ? 'Chegou! Confirme o recebimento'
          : 'A caminho da entrega'
        : c.retorno && c.status === 'em_andamento'
          ? 'Leva e traz em andamento'
          : ROTULO_STATUS[c.status];

  return (
    <ScrollView contentContainerStyle={s.conteudo}>
      <Stack.Screen options={{ title: c.servicoTitulo ?? (c.agendado ? `Frete · ${c.janela}` : 'Seu frete') }} />

      <View style={[s.topo, c.status === 'cancelado' && { backgroundColor: cores.cartao }, naColeta && c.status === 'no_local' && { backgroundColor: cores.alertaFundo }]}>
        <Text style={[s.topoTitulo, c.status === 'cancelado' && { color: cores.erro }, c.status === 'no_local' && { color: cores.alerta }]}>
          {titulo}
        </Text>
        {eta && c.status === 'aceito' && !c.aguardandoPagamento && (
          <Text style={s.eta}>
            Chega à coleta em <Text style={s.etaForte}>~{eta.min} min</Text> ({km(eta.km)} km)
            {etaCasaDepois ? `\nDepois, ~${etaCasaDepois.min} min até ${nomeDestino}` : ''}
          </Text>
        )}
        {eta && c.status === 'em_andamento' && (
          <Text style={s.eta}>
            Chega {entrega?.nome === 'Casa' ? 'na sua casa' : `a ${entrega?.nome}`} em <Text style={s.etaForte}>~{eta.min} min</Text> ({km(eta.km)} km)
          </Text>
        )}
        {c.status === 'pagamento_pendente' && <Text style={s.eta}>Finalize o pagamento para chamar o motorista.</Text>}
        {c.status === 'buscando' && (
          <Text style={s.eta}>
            {c.agendado ? `Agendado para ${c.janela}. Avisamos quando um motorista aceitar.` : 'Avisando os motoristas próximos…'}
            {'\n'}
            {c.pagarAoAceitar ? '💳 Você paga quando um motorista aceitar (Pix ou cartão à vista).' : '🔒 Seu pagamento está retido com segurança.'}
          </Text>
        )}
        {c.aguardandoPagamento && (
          <Text style={s.eta}>
            Pague até{' '}
            <Text style={s.etaForte}>{c.pagamentoAte ? new Date(c.pagamentoAte).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : 'agora'}</Text> com Pix ou cartão. Se não pagar
            a tempo, a corrida é cancelada.
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

      {(c.status === 'pagamento_pendente' || c.aguardandoPagamento) && (
        <Pressable style={s.botao} onPress={() => irParaPagamento(config.gateway, 'corrida', c.id)}>
          <Text style={s.botaoTexto}>Pagar {formatarReais(c.pacote ? preco(c.pacote.valor, c.pacote.taxaServico ?? 0) : preco(c.valor, c.taxaServico ?? 0))}</Text>
        </Pressable>
      )}

      {!naColeta && c.status === 'em_andamento' && (
        <View style={s.confirmar}>
          <Text style={s.confirmarTitulo}>{c.chegouDestinoEm ? 'Seu pedido chegou!' : 'Já recebeu?'}</Text>
          <Text style={s.confirmarTexto}>Confirme quando estiver com o pedido em mãos. Só então o pagamento é liberado para o motorista.</Text>
          <Pressable style={[s.botao, { backgroundColor: cores.alerta }]} onPress={confirmarRecebimento} disabled={ocupado}>
            {ocupado ? <ActivityIndicator color="#fff" /> : <Text style={s.botaoTexto}>Recebi, está tudo certo</Text>}
          </Pressable>
        </View>
      )}

      {naColeta && c.status === 'no_local' && (
        <View style={s.confirmar}>
          <Text style={s.confirmarTitulo}>O motorista chegou{c.coleta?.nome && c.coleta.nome !== 'Casa' ? ` ao ${c.coleta.nome}` : ''}?</Text>
          <Text style={s.confirmarTexto}>Confira a foto, o carro e a placa abaixo. Ao confirmar, o pagamento é liberado para ele e o frete começa.</Text>
          <Pressable style={[s.botao, { backgroundColor: cores.alerta }]} onPress={confirmar} disabled={ocupado}>
            {ocupado ? <ActivityIndicator color="#fff" /> : <Text style={s.botaoTexto}>Sim, o motorista está aqui</Text>}
          </Pressable>
        </View>
      )}

      {c.status === 'entregue' && c.motorista && <AvaliarFrete c={c} onAtualizar={setC} />}

      {estadoMapa && ['aceito', 'no_local', 'em_andamento'].includes(c.status) && <MapaRuas estado={estadoMapa} style={{ height: 320 }} />}

      {mot && c.status !== 'cancelado' && (
        <View style={s.motorista}>
          {foto ? <Image source={foto} style={s.foto} /> : <View style={[s.foto, s.fotoVazia]}><Text style={{ fontSize: 26 }}>🙂</Text></View>}
          <View style={{ flex: 1 }}>
            <Text style={s.motNome}>{mot.nome}</Text>
            <Text style={s.motCarro}>
              {mot.veiculo === 'moto' ? '🏍️ ' : ''}
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

      {!mot && ['buscando'].includes(c.status) && (
        <Pressable style={s.chatSuporte} onPress={() => router.push(`/chat/${c.id}`)}>
          <Text style={s.chatSuporteTexto}>💬 Falar com o suporte</Text>
        </Pressable>
      )}

      <View style={s.resumo}>
        {c.servicoTitulo ? <Linha a="Serviço" b={c.servicoTitulo} /> : null}
        <Linha a="Coleta" b={c.coleta ? `${c.coleta.nome}${c.coleta.nome !== c.coleta.endereco ? ` · ${c.coleta.endereco}` : ''}` : c.mercadoNome} />
        <Linha a={c.retorno ? 'Vai até' : 'Destino'} b={entrega ? `${entrega.nome}${entrega.nome !== entrega.endereco ? ` · ${entrega.endereco}` : ''}` : '—'} />
        {c.retorno ? <Linha a="Volta" b="Traz você de volta à coleta" /> : null}
        {c.descricao ? <Linha a="O que" b={c.descricao} /> : null}
        <Linha a="Quando" b={c.agendado ? c.janela : 'Agora'} />
        <Linha a="Valor" b={formatarReais(c.pagoEm ? Math.round((c.valor + (c.taxaServico ?? 0) + (c.taxaPagamento ?? 0)) * 100) / 100 : preco(c.valor, c.taxaServico ?? 0))} />
        {c.pacote ? <Linha a="Pacote" b={`${c.pacote.viagens} viagens · ${formatarReais(preco(c.pacote.valor, c.pacote.taxaServico ?? 0))}`} /> : null}
        {c.gorjeta ? <Linha a="Gorjeta" b={formatarReais(c.gorjeta)} /> : null}
        {c.pagoEm ? (
          <Linha a="Pagamento" b={`${c.metodo === 'pix' ? 'Pix' : 'Cartão'} · ${c.liberadoEm ? 'liberado ao motorista' : c.status === 'cancelado' ? 'devolução' : 'retido'}`} />
        ) : null}
      </View>
      {c.receiptUrl && (
        <Pressable onPress={() => WebBrowser.openBrowserAsync(c.receiptUrl!)}>
          <Text style={s.link}>Ver comprovante</Text>
        </Pressable>
      )}
      {c.pedidoId && (
        <Pressable onPress={() => router.push(`/meu-pedido/${c.pedidoId}`)}>
          <Text style={s.link}>🛵 Ver o pedido do delivery</Text>
        </Pressable>
      )}
      {!c.pedidoId && ['pagamento_pendente', 'buscando', 'aceito', 'no_local'].includes(c.status) && (
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
  topo: { backgroundColor: cores.primariaClara, borderRadius: raio, padding: 18, gap: 4 },
  topoTitulo: { fontSize: 20, fontWeight: '700', color: cores.primaria },
  eta: { fontSize: 15, color: cores.texto },
  etaForte: { fontWeight: '700', fontSize: 17 },
  etapas: { flexDirection: 'row', gap: 6, marginTop: 10 },
  etapa: { flex: 1, height: 6, borderRadius: 3, backgroundColor: cores.primariaMedia },
  etapaFeita: { backgroundColor: cores.primaria },
  confirmar: { backgroundColor: cores.alertaFundo, borderRadius: raio, padding: 18, gap: 8 },
  confirmarTitulo: { fontSize: 17, fontWeight: '700', color: cores.texto },
  confirmarTexto: { fontSize: 14, color: cores.suave },
  motorista: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: cores.cartao, borderRadius: raio, ...sombra, padding: 12 },
  foto: { width: 64, height: 64, borderRadius: 32 },
  fotoVazia: { backgroundColor: cores.fundo, alignItems: 'center', justifyContent: 'center' },
  motNome: { fontSize: 17, fontWeight: '700', color: cores.texto },
  motCarro: { fontSize: 14, color: cores.suave },
  placa: { alignSelf: 'flex-start', marginTop: 4, fontSize: 14, fontWeight: '700', letterSpacing: 1, backgroundColor: cores.fundo, color: cores.texto, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  chatSuporte: { backgroundColor: cores.primariaClara, borderRadius: raio, paddingVertical: 14, alignItems: 'center' },
  chatSuporteTexto: { color: cores.primaria, fontWeight: '700', fontSize: 15 },
  chat: { backgroundColor: cores.primariaClara, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 14 },
  chatTexto: { color: cores.primaria, fontWeight: '700' },
  resumo: { backgroundColor: cores.cartao, borderRadius: raio, ...sombra, padding: 12, gap: 6 },
  linha: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  linhaA: { color: cores.suave, fontSize: 14 },
  linhaB: { color: cores.texto, fontSize: 14, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  botao: { backgroundColor: cores.primaria, borderRadius: raio, paddingVertical: 16, alignItems: 'center' },
  botaoTexto: { color: '#fff', fontSize: 17, fontWeight: '700' },
  link: { color: cores.primaria, fontWeight: '700', fontSize: 15, textAlign: 'center', paddingVertical: 8 },
  erro: { color: cores.erro, fontSize: 13 },
});
