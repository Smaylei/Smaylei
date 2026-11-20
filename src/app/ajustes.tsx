import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { cores, raio } from '../components/tema';
import { useAgenda } from '../hooks/useAgendaCelular';
import * as Admin from '../services/admin';

export default function Ajustes() {
  const agenda = useAgenda();
  const [cfg, setCfg] = useState<Admin.ConfigServidor | null>(null);
  const [texto, setTexto] = useState({ horaInicio: '', horaFim: '', bloqueioMin: '', passoMin: '', antecedenciaMin: '', comissaoMotoristaPct: '', taxaDeslocamento: '', esperaPagamentoMin: '', ofertaMin: '', esperaConfirmacaoMin: '', raioChegadaM: '', saqueDias: '' });
  const [salvando, setSalvando] = useState(false);
  const { carregarOpcoes } = agenda;

  useFocusEffect(
    useCallback(() => {
      Admin.resumo()
        .then(({ config: c }) => {
          setCfg(c);
          setTexto({
            horaInicio: c.horaInicio,
            horaFim: c.horaFim,
            bloqueioMin: String(c.bloqueioMin),
            passoMin: String(c.passoMin),
            antecedenciaMin: String(c.antecedenciaMin),
            comissaoMotoristaPct: String(c.comissaoMotoristaPct),
            taxaDeslocamento: String(c.taxaDeslocamento).replace('.', ','),
            esperaPagamentoMin: String(c.esperaPagamentoMin),
            ofertaMin: String(c.ofertaMin),
            esperaConfirmacaoMin: String(c.esperaConfirmacaoMin),
            raioChegadaM: String(c.raioChegadaM),
            saqueDias: String(c.saqueDias),
          });
        })
        .catch((e) => Alert.alert('Erro', (e as Error).message));
      carregarOpcoes().catch(() => {});
    }, [carregarOpcoes]),
  );

  async function salvarAtendimento() {
    const hhmm = /^\d{2}:\d{2}$/;
    const n = (v: string) => Number(v.replace(',', '.'));
    if (!hhmm.test(texto.horaInicio) || !hhmm.test(texto.horaFim)) return Alert.alert('Horário inválido', 'Use o formato 08:00.');
    setSalvando(true);
    try {
      const novo = await Admin.salvarConfig({
        horaInicio: texto.horaInicio,
        horaFim: texto.horaFim,
        bloqueioMin: n(texto.bloqueioMin),
        passoMin: n(texto.passoMin),
        antecedenciaMin: n(texto.antecedenciaMin),
        comissaoMotoristaPct: n(texto.comissaoMotoristaPct),
        taxaDeslocamento: n(texto.taxaDeslocamento),
        esperaPagamentoMin: n(texto.esperaPagamentoMin),
        ofertaMin: n(texto.ofertaMin),
        esperaConfirmacaoMin: n(texto.esperaConfirmacaoMin),
        raioChegadaM: n(texto.raioChegadaM),
        saqueDias: n(texto.saqueDias),
      });
      setCfg(novo);
      Alert.alert('Salvo', 'Os novos valores já valem para clientes e motoristas.');
    } catch (e) {
      Alert.alert('Não salvou', (e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  async function compartilharAgenda() {
    try {
      const { url } = await Admin.linkAgenda();
      await Share.share({ message: url });
    } catch (e) {
      Alert.alert('Erro', (e as Error).message);
    }
  }

  async function testarWhatsapp() {
    try {
      await Admin.testarWhatsapp();
      Alert.alert('Enviado', 'Confira a mensagem de teste no seu WhatsApp.');
    } catch (e) {
      Alert.alert('WhatsApp', (e as Error).message);
    }
  }

  if (!cfg) return <ActivityIndicator style={{ marginTop: 60 }} color={cores.primaria} />;

  const campo = (rotulo: string, chave: keyof typeof texto, teclado: 'numeric' | 'numbers-and-punctuation' = 'numeric') => (
    <View style={s.campo}>
      <Text style={s.rotulo}>{rotulo}</Text>
      <TextInput style={s.input} value={texto[chave]} keyboardType={teclado} onChangeText={(v) => setTexto((t) => ({ ...t, [chave]: v }))} />
    </View>
  );

  return (
    <ScrollView contentContainerStyle={s.conteudo} keyboardShouldPersistTaps="handled">
      <Text style={s.secao}>Atendimento</Text>
      <View style={s.cartao}>
        <View style={s.grade}>
          {campo('Abre às', 'horaInicio', 'numbers-and-punctuation')}
          {campo('Fecha às', 'horaFim', 'numbers-and-punctuation')}
          {campo('Bloqueio por frete (min)', 'bloqueioMin')}
          {campo('Horários a cada (min)', 'passoMin')}
          {campo('Antecedência p/ agendar (min)', 'antecedenciaMin')}
          {campo('Procurar motorista por (min)', 'ofertaMin')}
        </View>
        <Text style={s.ajuda}>Cada frete ocupa o tempo de bloqueio do motorista (ida ao cliente e volta ao mercado). Os horários oferecidos dependem de quantos motoristas aprovados existem.</Text>
      </View>

      <Text style={s.secao}>Motoristas e cobrança</Text>
      <View style={s.cartao}>
        <View style={s.grade}>
          {campo('Parte do motorista (%)', 'comissaoMotoristaPct')}
          {campo('Taxa de deslocamento (R$)', 'taxaDeslocamento', 'numbers-and-punctuation')}
          {campo('Prazo para pagar o pedido (min)', 'esperaPagamentoMin')}
          {campo('Espera da confirmação no local (min)', 'esperaConfirmacaoMin')}
          {campo('Distância máx. p/ "Cheguei" (m)', 'raioChegadaM')}
          {campo('Saque a cada (dias)', 'saqueDias')}
        </View>
        <Text style={s.ajuda}>
          O cliente paga ao pedir; o valor fica retido até ele confirmar que o motorista chegou ao local da coleta. Se cancelar ou não aparecer com o motorista já no local, a taxa de deslocamento vai para o motorista e o resto é estornado.
        </Text>
        <Pressable style={s.botao} onPress={salvarAtendimento} disabled={salvando}>
          {salvando ? <ActivityIndicator color="#fff" /> : <Text style={s.botaoTexto}>Salvar ajustes</Text>}
        </Pressable>
      </View>

      <Pressable style={s.cartao} onPress={() => router.push('/tarifas')}>
        <Text style={s.item}>Tarifas Uber/99, margem e urgência ›</Text>
      </Pressable>

      <Text style={s.secao}>Agenda do celular</Text>
      <View style={s.cartao}>
        <View style={s.linha}>
          <Text style={[s.item, { flex: 1 }]}>Colocar fretes na agenda (lembrete 15 min antes)</Text>
          <Switch value={agenda.ativo} onValueChange={agenda.setAtivo} trackColor={{ true: cores.primaria }} />
        </View>
        {agenda.opcoes.length > 0 && <Text style={s.rotulo}>Agenda usada</Text>}
        {agenda.opcoes.map((c) => (
          <Pressable key={c.id} style={[s.opcao, agenda.calId === c.id && s.opcaoAtiva]} onPress={() => agenda.setCalId(c.id)}>
            <Text style={[s.opcaoTexto, agenda.calId === c.id && { color: cores.primaria }]}>
              {agenda.calId === c.id ? '● ' : '○ '}
              {c.titulo}
            </Text>
            {!!c.conta && <Text style={s.ajuda}>{c.conta}</Text>}
          </Pressable>
        ))}
        <Text style={s.ajuda}>No Android escolha a agenda da sua conta Google (ela aparece no Google Agenda). No iPhone, a agenda do iCloud ou do Google.</Text>
        <Pressable onPress={compartilharAgenda}>
          <Text style={s.link}>Copiar link da agenda (assinatura .ics)</Text>
        </Pressable>
        <Text style={s.ajuda}>
          Opcional, para ver os fretes em outro aparelho. Google Agenda no computador: Outras agendas → + → Do URL. iPhone: Ajustes → Calendário → Contas → Adicionar conta → Outra → Adicionar calendário assinado.
        </Text>
      </View>

      <Text style={s.secao}>WhatsApp</Text>
      <View style={s.cartao}>
        <Text style={s.ajuda}>
          Avisos de pedido, aceite, pagamento, cancelamento e novos motoristas chegam no WhatsApp +55 47 99914-9325 (falta só cadastrar a CALLMEBOT_APIKEY na Cloudflare).
        </Text>
        <Pressable onPress={testarWhatsapp}>
          <Text style={s.link}>Enviar mensagem de teste</Text>
        </Pressable>
      </View>

      <Pressable
        onPress={async () => {
          await Admin.sair();
          router.replace('/painel');
        }}
      >
        <Text style={[s.link, { color: cores.erro, textAlign: 'center', marginTop: 10 }]}>Sair</Text>
      </Pressable>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  conteudo: { padding: 16, paddingBottom: 40, gap: 10 },
  secao: { fontSize: 13, fontWeight: '800', color: cores.suave, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 8 },
  cartao: { backgroundColor: cores.cartao, borderRadius: raio, borderWidth: 1, borderColor: cores.borda, padding: 14, gap: 8 },
  grade: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  campo: { width: '47%' },
  rotulo: { fontSize: 12, color: cores.suave, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: cores.borda, borderRadius: 10, padding: 10, fontSize: 16, color: cores.texto, backgroundColor: cores.fundo },
  ajuda: { fontSize: 12, color: cores.suave },
  item: { fontSize: 15, fontWeight: '600', color: cores.texto },
  linha: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  opcao: { borderWidth: 1, borderColor: cores.borda, borderRadius: 10, padding: 10 },
  opcaoAtiva: { borderColor: cores.primaria, backgroundColor: cores.primariaClara },
  opcaoTexto: { fontSize: 15, fontWeight: '600', color: cores.texto },
  link: { color: cores.primaria, fontWeight: '700', fontSize: 15, paddingVertical: 4 },
  botao: { backgroundColor: cores.primaria, borderRadius: raio, paddingVertical: 14, alignItems: 'center' },
  botaoTexto: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
