import { Redirect, router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { cores, raio } from '../components/tema';
import { useAgenda } from '../hooks/useAgendaCelular';
import { api, ErroApi, ROTULO_STATUS, type CorridaMotorista } from '../services/api';
import { enviarPosicao, iniciarRastreio, pararRastreio, posicaoAtual } from '../services/localizacao';
import { eventosDaAgenda } from '../services/agendaMotorista';
import { formatarReais } from '../services/preco';

type Eu = {
  nome: string;
  status: 'pendente' | 'aprovado' | 'bloqueado';
  online: boolean;
  temSelfie: boolean;
  temCnh: boolean;
  disponivel: number;
  emLiberacao: number;
  comissaoPct: number;
  carro: string;
  placa: string;
};

const ATUALIZAR_MS = 5000;
const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

export default function Motorista() {
  const agenda = useAgenda();
  const [eu, setEu] = useState<Eu | null>(null);
  const [semConta, setSemConta] = useState(false);
  const [ofertas, setOfertas] = useState<CorridaMotorista[]>([]);
  const [minhas, setMinhas] = useState<CorridaMotorista[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [agora, setAgora] = useState(0);
  const segundoPlano = useRef(false);
  const { sincronizar } = agenda;

  const atualizar = useCallback(async () => {
    try {
      const e = await api<Eu>('motorista', '/v2/eu');
      setEu(e);
      if (e.online && !segundoPlano.current) {
        // Sem permissão de segundo plano: envia a posição enquanto a tela está aberta.
        const p = await posicaoAtual().catch(() => null);
        if (p) await enviarPosicao(p.lat, p.lon).catch(() => {});
      }
      const [o, m] = await Promise.all([api<CorridaMotorista[]>('motorista', '/v2/ofertas'), api<CorridaMotorista[]>('motorista', '/v2/agenda')]);
      setOfertas(o);
      setMinhas(m);
      setAgora(Date.now());
      sincronizar(eventosDaAgenda(m));
    } catch (e) {
      if (e instanceof ErroApi && e.status === 401) setSemConta(true);
      else setAviso((e as Error).message);
    }
  }, [sincronizar]);

  useFocusEffect(
    useCallback(() => {
      const t0 = setTimeout(atualizar, 0);
      const t = setInterval(atualizar, ATUALIZAR_MS);
      return () => {
        clearTimeout(t0);
        clearInterval(t);
      };
    }, [atualizar]),
  );

  async function alternarOnline(v: boolean) {
    setOcupado(true);
    setAviso(null);
    try {
      if (v) {
        const r = await iniciarRastreio();
        segundoPlano.current = r.segundoPlano;
        const p = await posicaoAtual();
        await api('motorista', '/v2/eu/online', { method: 'POST', corpo: { online: true, ...p } });
        if (!r.segundoPlano) setAviso('Sem permissão de localização "o tempo todo": mantenha o app aberto para receber corridas.');
      } else {
        await pararRastreio();
        await api('motorista', '/v2/eu/online', { method: 'POST', corpo: { online: false } });
      }
      await atualizar();
    } catch (e) {
      Alert.alert('Não foi possível', (e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function responder(c: CorridaMotorista, aceitar: boolean) {
    setOcupado(true);
    try {
      await api('motorista', `/v2/ofertas/${c.id}/${aceitar ? 'aceitar' : 'recusar'}`, { method: 'POST' });
      await atualizar();
      if (aceitar) router.push(`/corrida-motorista/${c.id}`);
    } catch (e) {
      Alert.alert('Não foi possível', (e as Error).message);
      atualizar();
    } finally {
      setOcupado(false);
    }
  }

  if (semConta) return <Redirect href="/cadastro-motorista" />;
  if (!eu) return <ActivityIndicator style={{ marginTop: 60 }} color={cores.primaria} />;

  const atual = minhas.find((c) => ['aceito', 'no_local', 'em_andamento'].includes(c.status) && Date.parse(c.inicio) - agora < 60 * 60000);
  const voltando = minhas.find((c) => c.status === 'entregue' && Date.parse(c.fim) > agora);
  const agoraOfertas = ofertas.filter((o) => !o.agendado);
  const agendadas = ofertas.length - agoraOfertas.length;
  const proximos = minhas.filter((c) => c !== atual && ['aceito'].includes(c.status));

  return (
    <ScrollView contentContainerStyle={s.conteudo} refreshControl={<RefreshControl refreshing={false} onRefresh={atualizar} />}>
      <Stack.Screen
        options={{
          title: 'Frete Motorista',
          headerRight: () => (
            <Pressable onPress={() => router.push('/agenda-motorista')} hitSlop={10}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>Agenda</Text>
            </Pressable>
          ),
        }}
      />

      {eu.status !== 'aprovado' ? (
        <View style={[s.status, s.statusEspera]}>
          <Text style={s.statusTitulo}>{eu.status === 'bloqueado' ? '⛔ Cadastro bloqueado' : '⏳ Cadastro em análise'}</Text>
          <Text style={s.statusSub}>
            {eu.status === 'bloqueado' ? 'Fale com a administração.' : 'Você recebe acesso assim que a administração aprovar seus documentos.'}
          </Text>
          {(!eu.temSelfie || !eu.temCnh) && (
            <Pressable onPress={() => router.push('/cadastro-motorista')}>
              <Text style={s.link}>Enviar selfie e CNH ›</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <View style={[s.status, eu.online ? s.statusOn : s.statusOff]}>
          <View style={s.linha}>
            <View style={{ flex: 1 }}>
              <Text style={s.statusTitulo}>{eu.online ? '🟢 Online' : '⚪ Offline'}</Text>
              <Text style={s.statusSub}>{eu.online ? 'Recebendo corridas e compartilhando sua posição.' : 'Fique online para receber corridas agora.'}</Text>
            </View>
            {ocupado ? <ActivityIndicator color={cores.primaria} /> : <Switch value={eu.online} onValueChange={alternarOnline} trackColor={{ true: cores.primaria }} />}
          </View>
        </View>
      )}
      {aviso && <Text style={s.aviso}>{aviso}</Text>}

      {atual && (
        <Pressable style={s.atual} onPress={() => router.push(`/corrida-motorista/${atual.id}`)}>
          <Text style={s.atualRotulo}>CORRIDA ATUAL</Text>
          <Text style={s.atualTitulo}>{ROTULO_STATUS[atual.status]}</Text>
          <Text style={[s.texto, { color: '#fff' }]}>
            {atual.mercado?.nome} → {atual.cliente?.nome} · {atual.agendado ? atual.janela : 'agora'}
          </Text>
          <Text style={[s.link, { color: '#fff' }]}>Abrir ›</Text>
        </Pressable>
      )}
      {voltando && !atual && (
        <View style={s.voltando}>
          <Text style={s.texto}>Voltando ao mercado. Bloqueado até {hora(voltando.fim)}.</Text>
          <Pressable
            style={s.botao}
            onPress={() =>
              api('motorista', '/v2/eu/livre', { method: 'POST' })
                .then(atualizar)
                .catch((e) => Alert.alert('Erro', (e as Error).message))
            }
          >
            <Text style={s.botaoTexto}>Estou livre</Text>
          </Pressable>
        </View>
      )}

      {eu.status === 'aprovado' && (
        <Pressable style={s.agendaCorridas} onPress={() => router.push('/agenda-corridas')}>
          <Text style={s.agendaCorridasTitulo}>📅 Agenda de corridas</Text>
          <Text style={s.detalhe}>
            {agendadas > 0 ? `${agendadas} corrida${agendadas > 1 ? 's' : ''} agendada${agendadas > 1 ? 's' : ''} disponível${agendadas > 1 ? 'eis' : ''} para aceitar` : 'Veja e aceite corridas dos próximos dias'}
          </Text>
        </Pressable>
      )}

      <Text style={s.secao}>Corridas de agora</Text>
      {agoraOfertas.length === 0 && <Text style={s.vazio}>{eu.online ? 'Nenhuma no momento. Avisamos quando aparecer.' : 'Fique online para receber corridas de agora.'}</Text>}
      {agoraOfertas.map((o) => (
        <View key={o.id} style={s.oferta}>
          <View style={s.linha}>
            <Text style={[s.selo, o.agendado ? s.seloAgendado : s.seloAgora]}>{o.agendado ? `AGENDADA · ${o.janela}` : 'AGORA'}</Text>
            <Text style={s.ganho}>{formatarReais(o.ganho)}</Text>
          </View>
          <Text style={s.texto}>🛒 Coleta: {o.mercado?.nome}</Text>
          <Text style={s.texto}>📍 Entrega: {o.cliente?.endereco}</Text>
          <Text style={s.detalhe}>
            {o.kmAteMercado != null ? `${o.kmAteMercado.toFixed(1).replace('.', ',')} km até o mercado · ` : ''}
            Corrida ida e volta {o.km.toFixed(1).replace('.', ',')} km · ~{o.minutos} min
          </Text>
          <View style={[s.linha, { marginTop: 8 }]}>
            <Pressable style={[s.botao, s.botaoSec]} onPress={() => responder(o, false)} disabled={ocupado}>
              <Text style={[s.botaoTexto, { color: cores.texto }]}>Recusar</Text>
            </Pressable>
            <Pressable style={[s.botao, { flex: 2 }]} onPress={() => responder(o, true)} disabled={ocupado}>
              <Text style={s.botaoTexto}>Aceitar</Text>
            </Pressable>
          </View>
        </View>
      ))}

      {proximos.length > 0 && (
        <>
          <Text style={s.secao}>Próximos agendados</Text>
          {proximos.map((c) => (
            <Pressable key={c.id} style={s.proximo} onPress={() => router.push(`/corrida-motorista/${c.id}`)}>
              <Text style={s.texto}>
                {c.janela} · {c.mercado?.nome} → {c.cliente?.nome}
              </Text>
              <Text style={s.detalhe}>{formatarReais(c.ganho)}</Text>
            </Pressable>
          ))}
        </>
      )}

      <Pressable style={s.ganhos} onPress={() => router.push('/saldo-motorista')}>
        <Text style={s.detalhe}>Saldo disponível para saque · você recebe {eu.comissaoPct}% do frete</Text>
        <Text style={s.ganhosValor}>{formatarReais(eu.disponivel)}</Text>
        {eu.emLiberacao > 0 && <Text style={s.detalhe}>+ {formatarReais(eu.emLiberacao)} em liberação (corridas aceitas)</Text>}
        <Text style={s.link}>Ver saldo e pedir saque ›</Text>
      </Pressable>
      <Text style={s.agendaInfo}>
        📅 Agenda do celular: {!agenda.ativo ? 'desligada' : agenda.ultima?.erro ? `⚠️ ${agenda.ultima.erro}` : agenda.ultima ? 'sincronizada' : '…'}
      </Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  conteudo: { padding: 16, paddingBottom: 40, gap: 10 },
  status: { borderRadius: raio, padding: 16, borderWidth: 1 },
  statusOn: { backgroundColor: cores.primariaClara, borderColor: cores.primaria },
  statusOff: { backgroundColor: cores.cartao, borderColor: cores.borda },
  statusEspera: { backgroundColor: cores.alertaFundo, borderColor: cores.alerta },
  statusTitulo: { fontSize: 19, fontWeight: '800', color: cores.texto },
  statusSub: { fontSize: 13, color: cores.suave, marginTop: 2 },
  linha: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  aviso: { fontSize: 13, color: cores.alerta, backgroundColor: cores.alertaFundo, padding: 10, borderRadius: 10 },
  atual: { backgroundColor: cores.primaria, borderRadius: raio, padding: 16, gap: 2 },
  atualRotulo: { fontSize: 11, fontWeight: '800', color: '#D7F0E1', letterSpacing: 0.5 },
  atualTitulo: { fontSize: 18, fontWeight: '800', color: '#fff' },
  voltando: { backgroundColor: cores.cartao, borderRadius: raio, borderWidth: 1, borderColor: cores.borda, padding: 14, gap: 8 },
  secao: { fontSize: 13, fontWeight: '800', color: cores.suave, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 8 },
  vazio: { color: cores.suave, fontSize: 14 },
  oferta: { backgroundColor: cores.cartao, borderRadius: raio, borderWidth: 2, borderColor: cores.primaria, padding: 14, gap: 4 },
  selo: { fontSize: 11, fontWeight: '800', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, overflow: 'hidden', color: '#fff' },
  seloAgendado: { backgroundColor: cores.primaria },
  seloAgora: { backgroundColor: cores.erro },
  ganho: { fontSize: 24, fontWeight: '800', color: cores.primaria },
  texto: { fontSize: 15, color: cores.texto },
  detalhe: { fontSize: 13, color: cores.suave },
  proximo: { backgroundColor: cores.cartao, borderRadius: raio, borderWidth: 1, borderColor: cores.borda, padding: 12, gap: 2 },
  agendaCorridas: { backgroundColor: cores.cartao, borderRadius: raio, borderWidth: 2, borderColor: '#1F4FA8', padding: 14, gap: 2 },
  agendaCorridasTitulo: { fontSize: 17, fontWeight: '800', color: '#1F4FA8' },
  ganhos: { backgroundColor: cores.cartao, borderRadius: raio, borderWidth: 1, borderColor: cores.borda, padding: 14, marginTop: 8 },
  ganhosValor: { fontSize: 26, fontWeight: '800', color: cores.primaria },
  agendaInfo: { fontSize: 12, color: cores.suave },
  botao: { flex: 1, backgroundColor: cores.primaria, borderRadius: raio, paddingVertical: 14, alignItems: 'center' },
  botaoSec: { backgroundColor: cores.cartao, borderWidth: 1, borderColor: cores.borda },
  botaoTexto: { color: '#fff', fontSize: 16, fontWeight: '700' },
  link: { color: cores.primaria, fontWeight: '700', fontSize: 15, marginTop: 4 },
});
