import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { cores, raio, sombra } from '../components/tema';
import { useAgenda, type EventoAgenda } from '../hooks/useAgendaCelular';
import { servicoPorId } from '../data/servicos';
import * as Admin from '../services/admin';
import { ErroApi, ROTULO_STATUS } from '../services/api';
import { formatarReais } from '../services/preco';

type Aba = 'andamento' | 'agendadas' | 'historico';
const ATUALIZAR_SEG = 15;
const ATIVAS = ['buscando', 'aceito', 'no_local', 'em_andamento'];

const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
const diaHora = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

function eventos(lista: Admin.CorridaAdmin[]): EventoAgenda[] {
  return lista
    .filter((c) => c.status !== 'buscando' || c.agendado)
    .map((c) => ({
      id: c.id,
      cancelado: c.status === 'cancelado',
      inicio: c.inicio,
      fim: c.fim,
      titulo: `${c.agendado ? '' : '🚨 '}${servicoPorId(c.servico).titulo}: ${c.coleta_nome ?? c.mercado_nome} → ${!c.entrega_nome || c.entrega_nome === 'Casa' ? c.cliente_nome : c.entrega_nome}`,
      local: c.coleta_endereco ?? c.cliente_endereco,
      notas: `${formatarReais(c.valor)} · Motorista: ${c.motorista_nome ?? 'a definir'}\nTel. cliente: ${c.cliente_telefone ?? '-'}`,
    }));
}

export default function Painel() {
  const agenda = useAgenda();
  const [logado, setLogado] = useState<boolean | null>(null);
  const [senha, setSenha] = useState('');
  const [res, setRes] = useState<Admin.Resumo | null>(null);
  const [lista, setLista] = useState<Admin.CorridaAdmin[]>([]);
  const [aba, setAba] = useState<Aba>('andamento');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [agora, setAgora] = useState(0);
  const { sincronizar } = agenda;

  const atualizar = useCallback(async () => {
    try {
      const [r, c, av] = await Promise.all([Admin.resumo(), Admin.corridas(), Admin.avisos()]);
      setRes(r);
      // Avisos novos (pedidos, aceites, cancelamentos, saques, mensagens) viram notificação no celular.
      const visto = Number((await AsyncStorage.getItem('avisos:visto').catch(() => null)) ?? 0);
      const novos = av.avisos.filter((a) => a.id > visto);
      if (visto > 0)
        for (const a of novos.slice(0, 3).reverse())
          Notifications.scheduleNotificationAsync({ content: { title: 'Frete Admin', body: a.texto.split('\n')[0], sound: true }, trigger: null }).catch(() => {});
      if (av.avisos[0]) AsyncStorage.setItem('avisos:visto', String(av.avisos[0].id)).catch(() => {});
      setLista(c);
      setAgora(Date.now());
      setLogado(true);
      setErro(null);
      sincronizar(eventos(c));
    } catch (e) {
      if (e instanceof ErroApi && e.status === 401) setLogado(false);
      else setErro((e as Error).message);
    }
  }, [sincronizar]);

  useFocusEffect(
    useCallback(() => {
      const t0 = setTimeout(atualizar, 0);
      const t = setInterval(atualizar, ATUALIZAR_SEG * 1000);
      return () => {
        clearTimeout(t0);
        clearInterval(t);
      };
    }, [atualizar]),
  );

  async function acao(fn: () => Promise<unknown>) {
    setOcupado(true);
    try {
      await fn();
      await atualizar();
    } catch (e) {
      Alert.alert('Não deu certo', (e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  const grupos = useMemo(() => {
    const andamento = lista.filter((c) => ATIVAS.includes(c.status) && (!c.agendado || Date.parse(c.inicio) - agora < 2 * 3600e3));
    const agendadas = lista.filter((c) => ATIVAS.includes(c.status) && !andamento.includes(c)).sort((a, b) => (a.inicio < b.inicio ? -1 : 1));
    const historico = lista.filter((c) => !ATIVAS.includes(c.status));
    return { andamento, agendadas, historico };
  }, [lista, agora]);

  if (logado === false)
    return (
      <View style={s.login}>
        <Stack.Screen options={{ title: 'Frete Admin' }} />
        <Text style={s.titulo}>Entrar</Text>
        <Text style={s.sub}>Use a senha ADMIN_TOKEN cadastrada na Cloudflare.</Text>
        <TextInput style={s.input} value={senha} onChangeText={setSenha} secureTextEntry placeholder="Senha" autoCapitalize="none" />
        <Pressable style={s.botao} onPress={() => acao(() => Admin.entrar(senha.trim()))}>
          {ocupado ? <ActivityIndicator color="#fff" /> : <Text style={s.botaoTexto}>Entrar</Text>}
        </Pressable>
      </View>
    );
  if (logado === null || !res) return <ActivityIndicator style={{ marginTop: 60 }} color={cores.primaria} />;

  const itens = grupos[aba];
  return (
    <ScrollView contentContainerStyle={s.conteudo} refreshControl={<RefreshControl refreshing={false} onRefresh={atualizar} />}>
      <Stack.Screen
        options={{
          title: 'Frete Admin',
          headerRight: () => (
            <View style={{ flexDirection: 'row', gap: 18 }}>
              <Pressable onPress={() => router.push('/avisos-admin')} hitSlop={10}>
                <Text style={{ color: cores.primaria, fontWeight: '700', fontSize: 15 }}>🔔{res.avisosNaoLidos ? ` ${res.avisosNaoLidos}` : ''}</Text>
              </Pressable>
              <Pressable onPress={() => router.push('/ajustes')} hitSlop={10}>
                <Text style={{ color: cores.primaria, fontWeight: '700', fontSize: 15 }}>Ajustes</Text>
              </Pressable>
            </View>
          ),
        }}
      />

      <View style={[s.status, res.config.aberto ? s.statusLivre : s.statusFechado]}>
        <View style={s.linha}>
          <View style={{ flex: 1 }}>
            <Text style={s.statusTitulo}>{res.config.aberto ? '✅ Aceitando pedidos' : '⏸ Fechado para pedidos'}</Text>
            <Text style={s.statusSub}>{res.disponibilidade.agora.ok ? 'Clientes podem pedir agora.' : res.disponibilidade.agora.motivo}</Text>
          </View>
          <Switch value={res.config.aberto} onValueChange={(v) => acao(() => Admin.salvarConfig({ aberto: v }))} trackColor={{ true: cores.primaria }} />
        </View>
      </View>

      <View style={s.numeros}>
        <Numero rotulo="Motoristas online" valor={String(res.motoristasOnline)} />
        <Numero rotulo="Corridas ativas" valor={String(res.corridasAtivas)} />
        <Numero rotulo="Faturado hoje" valor={formatarReais(res.faturamentoHoje)} />
        <Numero rotulo="Retido (antifraude)" valor={formatarReais(res.retido)} />
      </View>

      <View style={s.atalhos}>
        <Pressable style={s.atalho} onPress={() => router.push('/motoristas-admin')}>
          <Text style={s.atalhoTexto}>🚗 Motoristas{res.motoristasPendentes ? ` · ${res.motoristasPendentes} para aprovar` : ''}</Text>
        </Pressable>
        <Pressable style={s.atalho} onPress={() => router.push('/clientes-admin')}>
          <Text style={s.atalhoTexto}>👤 Clientes</Text>
        </Pressable>
      </View>
      <Pressable style={[s.atalho, { flex: 0 }]} onPress={() => router.push('/locais-admin')}>
        <Text style={s.atalhoTexto}>🏪 Locais: mercados, padarias, farmácias, gás, oficinas, borracharias</Text>
      </Pressable>
      <Pressable style={[s.atalho, { flex: 0 }, res.avaliacoesNaoLidas > 0 && s.atalhoAlerta]} onPress={() => router.push('/avaliacoes-admin')}>
        <Text style={s.atalhoTexto}>
          ⭐ Avaliações e sugestões{res.notaMedia ? ` · média ${res.notaMedia.toFixed(1).replace('.', ',')}` : ''}
          {res.avaliacoesNaoLidas ? ` · ${res.avaliacoesNaoLidas} nova${res.avaliacoesNaoLidas > 1 ? 's' : ''}` : ''}
        </Text>
      </Pressable>
      <View style={s.atalhos}>
        <Pressable style={[s.atalho, res.saquesPendentesQtd > 0 && s.atalhoAlerta]} onPress={() => router.push('/saques-admin')}>
          <Text style={s.atalhoTexto}>
            💸 Saques{res.saquesPendentesQtd ? ` · ${res.saquesPendentesQtd} a pagar (${formatarReais(res.saquesPendentes)})` : ''}
          </Text>
        </Pressable>
        <Pressable style={[s.atalho, res.estornosPendentesQtd > 0 && s.atalhoAlerta]} onPress={() => router.push('/estornos-admin')}>
          <Text style={s.atalhoTexto}>
            ↩️ Estornos{res.estornosPendentesQtd ? ` · ${res.estornosPendentesQtd} (${formatarReais(res.estornosPendentes)})` : ''}
          </Text>
        </Pressable>
      </View>
      <Text style={s.agenda}>
        📅 Agenda do celular: {!agenda.ativo ? 'desligada' : agenda.ultima?.erro ? `⚠️ ${agenda.ultima.erro}` : agenda.ultima ? `sincronizada às ${hora(agenda.ultima.quando.toISOString())}` : '…'}
      </Text>
      {erro && <Text style={s.erro}>{erro}</Text>}

      <View style={s.abas}>
        {(
          [
            ['andamento', `Agora (${grupos.andamento.length})`],
            ['agendadas', `Agendadas (${grupos.agendadas.length})`],
            ['historico', 'Histórico'],
          ] as const
        ).map(([id, texto]) => (
          <Pressable key={id} onPress={() => setAba(id)} style={[s.aba, aba === id && s.abaAtiva]}>
            <Text style={[s.abaTexto, aba === id && { color: '#fff' }]}>{texto}</Text>
          </Pressable>
        ))}
      </View>

      {itens.length === 0 && <Text style={s.vazio}>Nada por aqui.</Text>}
      {itens.map((c) => (
        <Cartao
          key={c.id}
          c={c}
          onCancelar={() =>
            Alert.alert('Cancelar corrida?', `${c.cliente_nome} · ${c.janela}${c.pago_em ? `\nO valor de ${formatarReais(c.valor)} vai para Estornos.` : ''}`, [
              { text: 'Voltar', style: 'cancel' },
              { text: 'Cancelar corrida', style: 'destructive', onPress: () => acao(() => Admin.cancelarCorrida(c.id)) },
            ])
          }
        />
      ))}
    </ScrollView>
  );
}

function Numero({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <View style={s.numero}>
      <Text style={s.numeroValor}>{valor}</Text>
      <Text style={s.numeroRotulo}>{rotulo}</Text>
    </View>
  );
}

function Cartao({ c, onCancelar }: { c: Admin.CorridaAdmin; onCancelar: () => void }) {
  const ativa = ATIVAS.includes(c.status);
  return (
    <View style={[s.cartao, !ativa && { opacity: c.status === 'cancelado' ? 0.65 : 0.9 }]}>
      <View style={s.linha}>
        <Text style={[s.selo, c.agendado ? s.seloAgendado : s.seloUrgente]}>{c.agendado ? 'AGENDADA' : 'AGORA'}</Text>
        <Text style={s.quando}>{c.agendado ? `${diaHora(c.inicio)}` : diaHora(c.criado_em)}</Text>
      </View>
      <Text style={s.statusCorrida}>{ROTULO_STATUS[c.status]}</Text>
      <Text style={s.cliente}>👤 {c.cliente_nome}</Text>
      <Text style={s.detalhe}>
        {servicoPorId(c.servico).icone} {servicoPorId(c.servico).titulo}
        {c.pacote_id ? ' · pacote' : ''}
      </Text>
      <Text style={s.detalhe}>
        📍 {c.coleta_nome ?? c.mercado_nome}
        {c.coleta_nome && c.coleta_nome !== 'Casa' && c.coleta_endereco ? ` · ${c.coleta_endereco.split(', Guaramirim')[0]}` : ''}
      </Text>
      <Text style={s.detalhe}>
        🏁 {!c.entrega_nome || c.entrega_nome === 'Casa' ? c.cliente_endereco : `${c.entrega_nome} · ${(c.entrega_endereco ?? '').split(', Guaramirim')[0]}`}
      </Text>
      {c.descricao ? <Text style={s.detalhe}>📝 {c.descricao}</Text> : null}
      <Text style={s.detalhe}>🚗 {c.motorista_nome ? `${c.motorista_nome} (${c.motorista_placa})` : 'procurando motorista…'}</Text>
      <View style={s.linha}>
        <Text style={s.valor}>{formatarReais(c.valor)}</Text>
        <Text style={s.detalhe}>
          {c.pago_em ? `${c.metodo === 'pix' ? 'Pix' : 'cartão'} · ${c.liberado_em ? 'liberado ao motorista' : c.status === 'cancelado' ? 'estorno' : '🔒 retido'}` : 'não pago'}
          {c.ganho_motorista ? ` · motorista ${formatarReais(c.ganho_motorista)}` : ''}
        </Text>
      </View>
      {c.status === 'cancelado' && (
        <Text style={s.erro}>
          Cancelada ({c.motivo === 'cliente_ausente' ? 'cliente não apareceu' : c.motivo === 'sem_motorista' ? 'sem motorista' : c.motivo === 'nao_pago' ? 'não pagou' : `por ${c.cancelado_por}`})
          {c.taxa_aplicada ? ` · taxa ${formatarReais(c.taxa_aplicada)} ao motorista` : ''}
          {c.reembolso > 0 ? ` · estorno ${formatarReais(c.reembolso)}${c.reembolsado_em ? ' feito' : ' pendente'}` : ''}
        </Text>
      )}
      <View style={s.botoes}>
        <Mini texto="Mapa" onPress={() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${c.cliente_lat},${c.cliente_lon}`)} />
        <Mini texto="💬 Chat" onPress={() => router.push(`/chat/${c.id}`)} />
        {ativa && <Mini texto="Cancelar" perigo onPress={onCancelar} />}
      </View>
    </View>
  );
}

function Mini({ texto, onPress, perigo }: { texto: string; onPress: () => void; perigo?: boolean }) {
  return (
    <Pressable onPress={onPress} style={[s.mini, perigo && { backgroundColor: cores.erroFundo }]}>
      <Text style={[s.miniTexto, perigo && { color: cores.erro }]}>{texto}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  conteudo: { padding: 16, paddingBottom: 40, gap: 10 },
  login: { padding: 24, gap: 10, marginTop: 30 },
  titulo: { fontSize: 24, fontWeight: '700', color: cores.texto },
  sub: { fontSize: 14, color: cores.suave },
  input: { backgroundColor: cores.cartao, ...sombra, borderRadius: raio, padding: 14, fontSize: 16, color: cores.texto },
  status: { borderRadius: raio, padding: 16 },
  statusLivre: { backgroundColor: cores.primariaClara, borderColor: cores.primaria },
  statusFechado: { backgroundColor: cores.alertaFundo, borderColor: cores.alerta },
  statusTitulo: { fontSize: 18, fontWeight: '700', color: cores.texto },
  statusSub: { fontSize: 13, color: cores.suave, marginTop: 2 },
  linha: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  numeros: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  numero: { width: '48%', backgroundColor: cores.cartao, borderRadius: raio, ...sombra, padding: 12 },
  numeroValor: { fontSize: 20, fontWeight: '700', color: cores.texto, fontVariant: ['tabular-nums'] },
  numeroRotulo: { fontSize: 12, color: cores.suave },
  atalhos: { flexDirection: 'row', gap: 8 },
  atalho: { flex: 1, backgroundColor: cores.cartao, borderRadius: raio, padding: 14, ...sombra },
  atalhoTexto: { fontSize: 14, fontWeight: '700', color: cores.primaria },
  atalhoAlerta: { borderColor: cores.alerta, backgroundColor: cores.alertaFundo },
  agenda: { fontSize: 12, color: cores.suave },
  erro: { color: cores.erro, fontSize: 13 },
  abas: { flexDirection: 'row', gap: 6, marginTop: 6 },
  aba: { flex: 1, ...sombra, borderRadius: 999, paddingVertical: 8, alignItems: 'center', backgroundColor: cores.cartao },
  abaAtiva: { backgroundColor: cores.primaria, borderColor: cores.primaria },
  abaTexto: { fontSize: 12, fontWeight: '700', color: cores.texto },
  vazio: { textAlign: 'center', color: cores.suave, marginTop: 16 },
  cartao: { backgroundColor: cores.cartao, borderRadius: raio, ...sombra, padding: 14, gap: 3 },
  selo: { fontSize: 11, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, overflow: 'hidden', color: '#fff' },
  seloAgendado: { backgroundColor: cores.primaria },
  seloUrgente: { backgroundColor: cores.erro },
  quando: { fontSize: 14, fontWeight: '700', color: cores.texto, flexShrink: 1, textAlign: 'right' },
  statusCorrida: { fontSize: 14, fontWeight: '700', color: cores.primaria, marginTop: 4 },
  cliente: { fontSize: 17, fontWeight: '700', color: cores.texto },
  detalhe: { fontSize: 14, color: cores.suave },
  valor: { fontSize: 18, fontWeight: '700', color: cores.primaria },
  botoes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  mini: { backgroundColor: cores.primariaClara, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 10 },
  miniTexto: { color: cores.primaria, fontWeight: '700', fontSize: 13 },
  botao: { backgroundColor: cores.primaria, borderRadius: raio, paddingVertical: 15, alignItems: 'center' },
  botaoTexto: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
