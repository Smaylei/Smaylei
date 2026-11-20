import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { cores, raio } from '../components/tema';
import { useAgenda } from '../hooks/useAgendaCelular';
import * as Admin from '../services/admin';

export default function Ajustes() {
  const agenda = useAgenda();
  const [cfg, setCfg] = useState<Admin.ConfigServidor | null>(null);
  const [texto, setTexto] = useState({ horaInicio: '', horaFim: '', bloqueioMin: '', passoMin: '', antecedenciaMin: '' });
  const [salvando, setSalvando] = useState(false);
  const { carregarOpcoes } = agenda;

  useFocusEffect(
    useCallback(() => {
      Admin.status()
        .then((s) => {
          setCfg(s.config);
          setTexto({
            horaInicio: s.config.horaInicio,
            horaFim: s.config.horaFim,
            bloqueioMin: String(s.config.bloqueioMin),
            passoMin: String(s.config.passoMin),
            antecedenciaMin: String(s.config.antecedenciaMin),
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
      });
      setCfg(novo);
      Alert.alert('Salvo', 'Os horários oferecidos aos clientes já foram atualizados.');
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
        </View>
        <Text style={s.ajuda}>Cada frete ocupa o tempo de bloqueio (ida ao cliente e volta ao mercado). Nesse intervalo ninguém consegue pedir ou agendar.</Text>
        <Pressable style={s.botao} onPress={salvarAtendimento} disabled={salvando}>
          {salvando ? <ActivityIndicator color="#fff" /> : <Text style={s.botaoTexto}>Salvar atendimento</Text>}
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
          Os avisos de frete urgente, agendado e cancelado chegam no número cadastrado no servidor (WHATSAPP_PHONE + CALLMEBOT_APIKEY na Cloudflare).
        </Text>
        <Pressable onPress={testarWhatsapp}>
          <Text style={s.link}>Enviar mensagem de teste</Text>
        </Pressable>
      </View>

      <Pressable
        onPress={async () => {
          await Admin.apagarSenha();
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
