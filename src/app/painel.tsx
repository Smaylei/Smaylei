import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { cores, raio } from '../components/tema';
import { useAgenda } from '../hooks/useAgendaCelular';
import * as Admin from '../services/admin';
import { formatarReais } from '../services/preco';

type Aba = 'proximos' | 'pendentes' | 'historico';
const ATUALIZAR_SEG = 20;

const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
const diaHora = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
const soDigitos = (t: string) => t.replace(/\D/g, '');

export default function Painel() {
  const agenda = useAgenda();
  const [logado, setLogado] = useState<boolean | null>(null);
  const [senha, setSenha] = useState('');
  const [st, setSt] = useState<Admin.StatusAdmin | null>(null);
  const [lista, setLista] = useState<Admin.PedidoAdmin[]>([]);
  const [aba, setAba] = useState<Aba>('proximos');
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [agora, setAgora] = useState(0);
  const { sincronizar } = agenda;

  const atualizar = useCallback(async () => {
    try {
      const [s, p] = await Promise.all([Admin.status(), Admin.pedidos()]);
      setSt(s);
      setLista(p);
      setAgora(Date.now());
      setLogado(true);
      setErro(null);
      sincronizar(p);
    } catch (e) {
      if (e instanceof Admin.SemAcesso) setLogado(false);
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
    setCarregando(true);
    try {
      await fn();
      await atualizar();
    } catch (e) {
      Alert.alert('Não deu certo', (e as Error).message);
    } finally {
      setCarregando(false);
    }
  }

  const grupos = useMemo(() => {
    const proximos = lista.filter((p) => p.status === 'pago' && Date.parse(p.fim) > agora).sort((a, b) => (a.inicio < b.inicio ? -1 : 1));
    const pendentes = lista.filter((p) => p.status === 'reservado' && p.expiraEm && Date.parse(p.expiraEm) > agora);
    const historico = lista.filter((p) => !proximos.includes(p) && !pendentes.includes(p) && p.status !== 'reservado');
    return { proximos, pendentes, historico };
  }, [lista, agora]);

  if (logado === false) {
    return (
      <View style={s.login}>
        <Stack.Screen options={{ title: 'Frete Admin' }} />
        <Text style={s.titulo}>Entrar</Text>
        <Text style={s.sub}>Use a senha ADMIN_TOKEN cadastrada na Cloudflare.</Text>
        <TextInput style={s.input} value={senha} onChangeText={setSenha} secureTextEntry placeholder="Senha" autoCapitalize="none" />
        <Pressable
          style={s.botao}
          onPress={() =>
            acao(async () => {
              await Admin.entrar(senha.trim());
              setSenha('');
            })
          }
        >
          {carregando ? <ActivityIndicator color="#fff" /> : <Text style={s.botaoTexto}>Entrar</Text>}
        </Pressable>
      </View>
    );
  }
  if (logado === null) return <ActivityIndicator style={{ marginTop: 60 }} color={cores.primaria} />;

  const cfg = st?.config;
  const ocupado = st?.ocupadoAte;
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

      {/* Status: aceitando pedidos + Estou livre */}
      <View style={[s.status, ocupado ? s.statusOcupado : s.statusLivre]}>
        <View style={s.linha}>
          <View style={{ flex: 1 }}>
            <Text style={s.statusTitulo}>{ocupado ? `🚗 Em atendimento até ${hora(ocupado)}` : cfg?.aberto ? '✅ Livre' : '⏸ Fechado'}</Text>
            <Text style={s.statusSub}>
              {cfg?.aberto ? (st?.agora.ok ? 'Recebendo pedidos agora e agendamentos.' : (st?.agora.motivo ?? '')) : 'Clientes não conseguem pedir nem agendar.'}
            </Text>
          </View>
          <View style={{ alignItems: 'center' }}>
            <Switch
              value={!!cfg?.aberto}
              onValueChange={(v) => acao(() => Admin.salvarConfig({ aberto: v }))}
              trackColor={{ true: cores.primaria }}
            />
            <Text style={s.mini}>Aceitando</Text>
          </View>
        </View>
        {(ocupado || !cfg?.aberto) && (
          <Pressable style={[s.botao, { marginTop: 12 }]} onPress={() => acao(Admin.estouLivre)} disabled={carregando}>
            {carregando ? <ActivityIndicator color="#fff" /> : <Text style={s.botaoTexto}>Estou livre</Text>}
          </Pressable>
        )}
      </View>

      <Pressable onPress={() => router.push('/ajustes')}>
        <Text style={s.agenda}>
          📅 Agenda do celular:{' '}
          {!agenda.ativo ? 'desligada' : agenda.ultima?.erro ? `⚠️ ${agenda.ultima.erro}` : agenda.ultima ? `sincronizada às ${hora(agenda.ultima.quando.toISOString())}` : 'sincronizando…'}
        </Text>
      </Pressable>
      {erro && <Text style={s.erro}>{erro}</Text>}

      <View style={s.abas}>
        {(
          [
            ['proximos', `Próximos (${grupos.proximos.length})`],
            ['pendentes', `Aguardando pgto (${grupos.pendentes.length})`],
            ['historico', 'Histórico'],
          ] as const
        ).map(([id, texto]) => (
          <Pressable key={id} onPress={() => setAba(id)} style={[s.aba, aba === id && s.abaAtiva]}>
            <Text style={[s.abaTexto, aba === id && { color: '#fff' }]}>{texto}</Text>
          </Pressable>
        ))}
      </View>

      {itens.length === 0 && <Text style={s.vazio}>{aba === 'proximos' ? 'Nenhum frete marcado. Os novos aparecem aqui.' : 'Nada por aqui.'}</Text>}
      {itens.map((p) => (
        <CartaoPedido key={p.orderNsu} p={p} ocupado={carregando} onConcluir={() => acao(() => Admin.concluir(p.orderNsu))} onCancelar={() =>
          Alert.alert('Cancelar frete?', `${p.cliente.nome || 'Cliente'} · ${p.janela}\nO horário volta a ficar vago. O estorno de ${formatarReais(p.valor)} é feito no app da InfinitePay.`, [
            { text: 'Voltar', style: 'cancel' },
            { text: 'Cancelar frete', style: 'destructive', onPress: () => acao(() => Admin.cancelar(p.orderNsu)) },
          ])
        } />
      ))}
    </ScrollView>
  );
}

function CartaoPedido({ p, onConcluir, onCancelar, ocupado }: { p: Admin.PedidoAdmin; onConcluir: () => void; onCancelar: () => void; ocupado: boolean }) {
  const tel = p.cliente.telefone ? soDigitos(p.cliente.telefone) : '';
  const wa = tel ? `https://wa.me/${tel.startsWith('55') ? tel : `55${tel}`}` : null;
  const ativo = p.status === 'pago';
  const rotulo = { pago: p.metodo === 'pix' ? 'Pago · Pix' : 'Pago · cartão', reservado: 'Aguardando pagamento', cancelado: `Cancelado${p.canceladoPor === 'cliente' ? ' pelo cliente' : ''}`, concluido: 'Concluído' }[p.status];
  return (
    <View style={[s.cartao, !ativo && { opacity: p.status === 'cancelado' ? 0.65 : 0.85 }]}>
      <View style={s.linha}>
        <Text style={[s.selo, p.agendado ? s.seloAgendado : s.seloUrgente]}>{p.agendado ? 'AGENDADO' : 'URGENTE'}</Text>
        <Text style={s.quando}>{p.agendado ? `${diaHora(p.inicio)}–${hora(p.fim)}` : `${diaHora(p.inicio)}`}</Text>
      </View>
      <Text style={s.cliente}>{p.cliente.nome || 'Cliente'}</Text>
      <Text style={s.detalhe}>📍 {p.cliente.endereco}</Text>
      <Text style={s.detalhe}>🛒 {p.mercadoNome}</Text>
      <View style={s.linha}>
        <Text style={s.valor}>{formatarReais(p.valor)}</Text>
        <Text style={s.detalhe}>{rotulo}</Text>
      </View>
      {p.status === 'cancelado' && p.pagoEm && <Text style={s.erro}>Estornar {formatarReais(p.valor)} no app da InfinitePay.</Text>}
      <View style={s.botoes}>
        <Botao texto="Navegar" onPress={() => Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${p.cliente.lat},${p.cliente.lon}`)} />
        {wa && <Botao texto="WhatsApp" onPress={() => Linking.openURL(wa)} />}
        {ativo && <Botao texto="Concluir" onPress={onConcluir} disabled={ocupado} />}
        {(ativo || p.status === 'reservado') && <Botao texto="Cancelar" perigo onPress={onCancelar} disabled={ocupado} />}
      </View>
    </View>
  );
}

function Botao({ texto, onPress, perigo, disabled }: { texto: string; onPress: () => void; perigo?: boolean; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[s.mini_botao, perigo && { borderColor: cores.erro }]}>
      <Text style={[s.mini_botaoTexto, perigo && { color: cores.erro }]}>{texto}</Text>
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
  statusOcupado: { backgroundColor: cores.alertaFundo, borderColor: cores.alerta },
  statusTitulo: { fontSize: 19, fontWeight: '800', color: cores.texto },
  statusSub: { fontSize: 13, color: cores.suave, marginTop: 2 },
  linha: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  mini: { fontSize: 11, color: cores.suave },
  agenda: { fontSize: 13, color: cores.suave },
  erro: { color: cores.erro, fontSize: 13 },
  abas: { flexDirection: 'row', gap: 6, marginTop: 6 },
  aba: { flex: 1, borderWidth: 1, borderColor: cores.borda, borderRadius: 999, paddingVertical: 8, alignItems: 'center', backgroundColor: cores.cartao },
  abaAtiva: { backgroundColor: cores.primaria, borderColor: cores.primaria },
  abaTexto: { fontSize: 12, fontWeight: '700', color: cores.texto },
  vazio: { textAlign: 'center', color: cores.suave, marginTop: 20 },
  cartao: { backgroundColor: cores.cartao, borderRadius: raio, borderWidth: 1, borderColor: cores.borda, padding: 14, gap: 4 },
  selo: { fontSize: 11, fontWeight: '800', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, overflow: 'hidden', color: '#fff' },
  seloAgendado: { backgroundColor: cores.primaria },
  seloUrgente: { backgroundColor: cores.erro },
  quando: { fontSize: 14, fontWeight: '700', color: cores.texto, flexShrink: 1, textAlign: 'right' },
  cliente: { fontSize: 18, fontWeight: '800', color: cores.texto, marginTop: 4 },
  detalhe: { fontSize: 14, color: cores.suave },
  valor: { fontSize: 18, fontWeight: '800', color: cores.primaria },
  botoes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  mini_botao: { borderWidth: 1, borderColor: cores.primaria, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12 },
  mini_botaoTexto: { color: cores.primaria, fontWeight: '700', fontSize: 14 },
  botao: { backgroundColor: cores.primaria, borderRadius: raio, paddingVertical: 15, alignItems: 'center' },
  botaoTexto: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
