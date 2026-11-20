import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Switch, Text, View } from 'react-native';
import { cores, raio } from '../components/tema';
import { useAgenda } from '../hooks/useAgendaCelular';
import { api, apagarToken, ROTULO_STATUS, type CorridaMotorista } from '../services/api';
import { eventosDaAgenda } from '../services/agendaMotorista';
import { pararRastreio } from '../services/localizacao';
import { formatarReais } from '../services/preco';

const dia = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });
const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

/** Agenda pessoal do motorista: agendados por dia + corridas de agora. */
export default function AgendaMotorista() {
  const agenda = useAgenda();
  const [lista, setLista] = useState<CorridaMotorista[]>([]);
  const [historico, setHistorico] = useState<CorridaMotorista[]>([]);
  const [link, setLink] = useState<string | null>(null);
  const { sincronizar, carregarOpcoes } = agenda;

  const carregar = useCallback(async () => {
    try {
      const [a, h, eu] = await Promise.all([
        api<CorridaMotorista[]>('motorista', '/v2/agenda'),
        api<CorridaMotorista[]>('motorista', '/v2/historico'),
        api<{ agendaLink: string }>('motorista', '/v2/eu'),
      ]);
      setLista(a.filter((c) => c.status !== 'cancelado'));
      setHistorico(h.filter((c) => ['entregue', 'pago'].includes(c.status)));
      setLink(eu.agendaLink);
      sincronizar(eventosDaAgenda(a));
    } catch (e) {
      Alert.alert('Erro', (e as Error).message);
    }
  }, [sincronizar]);

  useFocusEffect(
    useCallback(() => {
      const t = setTimeout(carregar, 0);
      carregarOpcoes().catch(() => {});
      return () => clearTimeout(t);
    }, [carregar, carregarOpcoes]),
  );

  const porDia = lista.reduce<Record<string, CorridaMotorista[]>>((acc, c) => {
    (acc[dia(c.inicio)] ??= []).push(c);
    return acc;
  }, {});

  return (
    <ScrollView contentContainerStyle={s.conteudo} refreshControl={<RefreshControl refreshing={false} onRefresh={carregar} />}>
      {Object.keys(porDia).length === 0 && <Text style={s.vazio}>Nenhuma corrida marcada. As que você aceitar aparecem aqui e na agenda do celular.</Text>}
      {Object.entries(porDia).map(([d, cs]) => (
        <View key={d} style={{ gap: 8 }}>
          <Text style={s.dia}>{d}</Text>
          {cs.map((c) => (
            <Pressable key={c.id} style={s.item} onPress={() => router.push(`/corrida-motorista/${c.id}`)}>
              <Text style={s.hora}>{c.agendado ? hora(c.inicio) : 'AGORA'}</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.texto}>
                  {c.mercado?.nome} → {c.cliente?.nome}
                </Text>
                <Text style={s.detalhe}>
                  {ROTULO_STATUS[c.status]} · {formatarReais(c.ganho)}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      ))}

      <Text style={s.secao}>Agenda do celular</Text>
      <View style={s.cartao}>
        <View style={s.linha}>
          <Text style={[s.texto, { flex: 1 }]}>Colocar corridas na agenda (lembrete 15 min antes)</Text>
          <Switch value={agenda.ativo} onValueChange={agenda.setAtivo} trackColor={{ true: cores.primaria }} />
        </View>
        {agenda.opcoes.map((o) => (
          <Pressable key={o.id} style={[s.opcao, agenda.calId === o.id && s.opcaoAtiva]} onPress={() => agenda.setCalId(o.id)}>
            <Text style={s.texto}>
              {agenda.calId === o.id ? '● ' : '○ '}
              {o.titulo}
            </Text>
            {!!o.conta && <Text style={s.detalhe}>{o.conta}</Text>}
          </Pressable>
        ))}
        {link && (
          <Pressable onPress={() => Share.share({ message: link })}>
            <Text style={s.link}>Copiar link da agenda (.ics)</Text>
          </Pressable>
        )}
      </View>

      {historico.length > 0 && (
        <>
          <Text style={s.secao}>Últimas corridas</Text>
          {historico.slice(0, 15).map((c) => (
            <View key={c.id} style={s.hist}>
              <Text style={s.detalhe}>
                {dia(c.inicio)} · {c.mercado?.nome} → {c.cliente?.nome}
              </Text>
              <Text style={s.texto}>{formatarReais(c.ganho)}</Text>
            </View>
          ))}
        </>
      )}

      <Pressable onPress={() => router.push('/cadastro-motorista')}>
        <Text style={[s.link, { textAlign: 'center' }]}>Meus documentos</Text>
      </Pressable>
      <Pressable
        onPress={async () => {
          await pararRastreio();
          await api('motorista', '/v2/eu/online', { method: 'POST', corpo: { online: false } }).catch(() => {});
          await apagarToken('motorista');
          router.replace('/cadastro-motorista');
        }}
      >
        <Text style={[s.link, { color: cores.erro, textAlign: 'center' }]}>Sair deste celular</Text>
      </Pressable>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  conteudo: { padding: 16, paddingBottom: 40, gap: 10 },
  vazio: { color: cores.suave, fontSize: 14, textAlign: 'center', marginTop: 10 },
  dia: { fontSize: 14, fontWeight: '800', color: cores.texto, textTransform: 'capitalize', marginTop: 6 },
  item: { flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: cores.cartao, borderRadius: raio, borderWidth: 1, borderColor: cores.borda, padding: 12 },
  hora: { fontSize: 18, fontWeight: '800', color: cores.primaria, width: 64 },
  texto: { fontSize: 15, fontWeight: '600', color: cores.texto },
  detalhe: { fontSize: 13, color: cores.suave },
  secao: { fontSize: 13, fontWeight: '800', color: cores.suave, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 12 },
  cartao: { backgroundColor: cores.cartao, borderRadius: raio, borderWidth: 1, borderColor: cores.borda, padding: 12, gap: 8 },
  linha: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  opcao: { borderWidth: 1, borderColor: cores.borda, borderRadius: 10, padding: 10 },
  opcaoAtiva: { borderColor: cores.primaria, backgroundColor: cores.primariaClara },
  link: { color: cores.primaria, fontWeight: '700', fontSize: 15, paddingVertical: 8 },
  hist: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, paddingVertical: 4 },
});
