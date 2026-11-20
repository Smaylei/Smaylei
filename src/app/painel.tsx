import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { cores, raio } from '../components/tema';
import { useAgenda, type EventoAgenda } from '../hooks/useAgendaCelular';
import * as Admin from '../services/admin';
import { ErroApi, ROTULO_STATUS } from '../services/api';
import { formatarReais } from '../services/preco';

type Aba = 'andamento' | 'agendadas' | 'historico';
const ATUALIZAR_SEG = 15;
const ATIVAS = ['buscando', 'aceito', 'aguardando_pagamento', 'pago'];

const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
const diaHora = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
const wa = (t?: string | null) => {
  const d = (t ?? '').replace(/\D/g, '');
  return d ? `https://wa.me/${d.startsWith('55') ? d : `55${d}`}` : null;
};

function eventos(lista: Admin.CorridaAdmin[]): EventoAgenda[] {
  return lista
    .filter((c) => c.status !== 'buscando' || c.agendado)
    .map((c) => ({
      id: c.id,
      cancelado: c.status === 'cancelado',
      inicio: c.inicio,
      fim: c.fim,
      titulo: `${c.agendado ? '' : '🚨 '}Frete ${c.mercado_nome} → ${c.cliente_nome}`,
      local: c.cliente_endereco,
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
      const [r, c] = await Promise.all([Admin.resumo(), Admin.corridas()]);
      setRes(r);
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
            <Pressable onPress={() => router.push('/ajustes')} hitSlop={10}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>Ajustes</Text>
            </Pressable>
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
        <Numero rotulo="A repassar" valor={formatarReais(res.aRepassar)} />
      </View>

      <View style={s.atalhos}>
        <Pressable style={s.atalho} onPress={() => router.push('/motoristas-admin')}>
          <Text style={s.atalhoTexto}>🚗 Motoristas{res.motoristasPendentes ? ` · ${res.motoristasPendentes} para aprovar` : ''}</Text>
        </Pressable>
        <Pressable style={s.atalho} onPress={() => router.push('/clientes-admin')}>
          <Text style={s.atalhoTexto}>👤 Clientes</Text>
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
            Alert.alert('Cancelar corrida?', `${c.cliente_nome} · ${c.janela}${c.pago_em ? `\nEstorne ${formatarReais(c.valor_cobrado ?? c.valor)} no app da InfinitePay.` : ''}`, [
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
  const waCli = wa(c.cliente_telefone), waMot = wa(c.motorista_telefone);
  return (
    <View style={[s.cartao, !ativa && { opacity: c.status === 'cancelado' ? 0.65 : 0.9 }]}>
      <View style={s.linha}>
        <Text style={[s.selo, c.agendado ? s.seloAgendado : s.seloUrgente]}>{c.agendado ? 'AGENDADA' : 'AGORA'}</Text>
        <Text style={s.quando}>{c.agendado ? `${diaHora(c.inicio)}` : diaHora(c.criado_em)}</Text>
      </View>
      <Text style={s.statusCorrida}>{ROTULO_STATUS[c.status]}</Text>
      <Text style={s.cliente}>👤 {c.cliente_nome}</Text>
      <Text style={s.detalhe}>📍 {c.cliente_endereco}</Text>
      <Text style={s.detalhe}>🛒 {c.mercado_nome}</Text>
      <Text style={s.detalhe}>🚗 {c.motorista_nome ? `${c.motorista_nome} (${c.motorista_placa})` : 'procurando motorista…'}</Text>
      <View style={s.linha}>
        <Text style={s.valor}>{formatarReais(c.valor_cobrado ?? c.valor)}</Text>
        <Text style={s.detalhe}>
          {c.pago_em ? `Pago · ${c.metodo === 'pix' ? 'Pix' : 'cartão'}` : ''}
          {c.ganho_motorista ? ` · motorista ${formatarReais(c.ganho_motorista)}` : ''}
        </Text>
      </View>
      {c.status === 'cancelado' && (
        <Text style={s.erro}>
          Cancelada ({c.motivo === 'nao_pagou' ? 'cliente não pagou' : c.motivo === 'sem_motorista' ? 'sem motorista' : `por ${c.cancelado_por}`})
          {c.taxa_aplicada ? ` · taxa ${formatarReais(c.taxa_aplicada)}` : ''}
          {c.pago_em ? ` · estornar ${formatarReais(c.valor_cobrado ?? c.valor)}` : ''}
        </Text>
      )}
      <View style={s.botoes}>
        <Mini texto="Mapa" onPress={() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${c.cliente_lat},${c.cliente_lon}`)} />
        {waCli && <Mini texto="WhatsApp cliente" onPress={() => Linking.openURL(waCli)} />}
        {waMot && <Mini texto="WhatsApp motorista" onPress={() => Linking.openURL(waMot)} />}
        {ativa && <Mini texto="Cancelar" perigo onPress={onCancelar} />}
      </View>
    </View>
  );
}

function Mini({ texto, onPress, perigo }: { texto: string; onPress: () => void; perigo?: boolean }) {
  return (
    <Pressable onPress={onPress} style={[s.mini, perigo && { borderColor: cores.erro }]}>
      <Text style={[s.miniTexto, perigo && { color: cores.erro }]}>{texto}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  conteudo: { padding: 16, paddingBottom: 40, gap: 10 },
  login: { padding: 24, gap: 10, marginTop: 30 },
  titulo: { fontSize: 24, fontWeight: '800', color: cores.texto },
  sub: { fontSize: 14, color: cores.suave },
  input: { backgroundColor: cores.cartao, borderWidth: 1, borderColor: cores.borda, borderRadius: raio, padding: 14, fontSize: 16, color: cores.texto },
  status: { borderRadius: raio, padding: 16, borderWidth: 1 },
  statusLivre: { backgroundColor: cores.primariaClara, borderColor: cores.primaria },
  statusFechado: { backgroundColor: cores.alertaFundo, borderColor: cores.alerta },
  statusTitulo: { fontSize: 18, fontWeight: '800', color: cores.texto },
  statusSub: { fontSize: 13, color: cores.suave, marginTop: 2 },
  linha: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  numeros: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  numero: { width: '48%', backgroundColor: cores.cartao, borderRadius: raio, borderWidth: 1, borderColor: cores.borda, padding: 12 },
  numeroValor: { fontSize: 20, fontWeight: '800', color: cores.texto, fontVariant: ['tabular-nums'] },
  numeroRotulo: { fontSize: 12, color: cores.suave },
  atalhos: { flexDirection: 'row', gap: 8 },
  atalho: { flex: 1, backgroundColor: cores.cartao, borderRadius: raio, borderWidth: 1, borderColor: cores.primaria, padding: 12 },
  atalhoTexto: { fontSize: 14, fontWeight: '700', color: cores.primaria },
  agenda: { fontSize: 12, color: cores.suave },
  erro: { color: cores.erro, fontSize: 13 },
  abas: { flexDirection: 'row', gap: 6, marginTop: 6 },
  aba: { flex: 1, borderWidth: 1, borderColor: cores.borda, borderRadius: 999, paddingVertical: 8, alignItems: 'center', backgroundColor: cores.cartao },
  abaAtiva: { backgroundColor: cores.primaria, borderColor: cores.primaria },
  abaTexto: { fontSize: 12, fontWeight: '700', color: cores.texto },
  vazio: { textAlign: 'center', color: cores.suave, marginTop: 16 },
  cartao: { backgroundColor: cores.cartao, borderRadius: raio, borderWidth: 1, borderColor: cores.borda, padding: 14, gap: 3 },
  selo: { fontSize: 11, fontWeight: '800', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, overflow: 'hidden', color: '#fff' },
  seloAgendado: { backgroundColor: cores.primaria },
  seloUrgente: { backgroundColor: cores.erro },
  quando: { fontSize: 14, fontWeight: '700', color: cores.texto, flexShrink: 1, textAlign: 'right' },
  statusCorrida: { fontSize: 14, fontWeight: '700', color: cores.primaria, marginTop: 4 },
  cliente: { fontSize: 17, fontWeight: '800', color: cores.texto },
  detalhe: { fontSize: 14, color: cores.suave },
  valor: { fontSize: 18, fontWeight: '800', color: cores.primaria },
  botoes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  mini: { borderWidth: 1, borderColor: cores.primaria, borderRadius: 10, paddingVertical: 7, paddingHorizontal: 10 },
  miniTexto: { color: cores.primaria, fontWeight: '700', fontSize: 13 },
  botao: { backgroundColor: cores.primaria, borderRadius: raio, paddingVertical: 15, alignItems: 'center' },
  botaoTexto: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
