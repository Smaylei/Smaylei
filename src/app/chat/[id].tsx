import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { cores } from '../../components/tema';
import { api, type Mensagem } from '../../services/api';
import { VARIANTE } from '../../variante';

const NOME = { cliente: 'Cliente', motorista: 'Motorista', suporte: 'Suporte' } as const;

/** Chat interno da corrida: cliente, motorista da vez e suporte (Admin). Mesmo componente nos três apps. */
export default function Chat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const papel = VARIANTE === 'motorista' ? 'motorista' : VARIANTE === 'admin' ? 'admin' : 'cliente';
  const eu = papel === 'admin' ? 'suporte' : papel;
  const rota = papel === 'admin' ? `/v2/admin/corridas/${id}/mensagens` : `/v2/corridas/${id}/mensagens`;
  const insets = useSafeAreaInsets();
  const [msgs, setMsgs] = useState<Mensagem[]>([]);
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const ultimo = useRef(0);
  const lista = useRef<FlatList<Mensagem>>(null);

  const juntar = useCallback((novas: Mensagem[]) => {
    if (!novas.length) return;
    ultimo.current = novas[novas.length - 1].id;
    setMsgs((m) => [...m, ...novas.filter((n) => !m.some((x) => x.id === n.id))]);
  }, []);

  const buscar = useCallback(async () => {
    try {
      juntar(await api<Mensagem[]>(papel, `${rota}?depois=${ultimo.current}`));
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [rota, papel, juntar]);

  useFocusEffect(
    useCallback(() => {
      const t0 = setTimeout(buscar, 0);
      const t = setInterval(buscar, 3000);
      return () => {
        clearTimeout(t0);
        clearInterval(t);
      };
    }, [buscar]),
  );

  async function enviar() {
    const t = texto.trim();
    if (!t) return;
    setTexto('');
    try {
      juntar(await api<Mensagem[]>(papel, `${rota}?depois=${ultimo.current}`, { method: 'POST', corpo: { texto: t } }));
    } catch (e) {
      setErro((e as Error).message);
      setTexto(t);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <FlatList
        ref={lista}
        data={msgs}
        keyExtractor={(m) => String(m.id)}
        contentContainerStyle={{ padding: 12, gap: 8 }}
        onContentSizeChange={() => lista.current?.scrollToEnd({ animated: true })}
        ListEmptyComponent={<Text style={s.vazio}>Converse sobre a entrega por aqui. O suporte também acompanha este chat.</Text>}
        renderItem={({ item }) => {
          const meu = item.autor === eu;
          return (
            <View style={[s.balao, meu ? s.meu : item.autor === 'suporte' ? s.suporte : s.outro]}>
              {!meu && <Text style={s.autor}>{NOME[item.autor]}</Text>}
              <Text style={[s.texto, meu && { color: '#fff' }]}>{item.texto}</Text>
              <Text style={[s.hora, meu && { color: '#D7F0E1' }]}>
                {new Date(item.criadoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
              </Text>
            </View>
          );
        }}
      />
      {erro && <Text style={s.erro}>{erro}</Text>}
      <View style={[s.barra, { paddingBottom: 8 + insets.bottom }]}>
        <TextInput style={s.input} value={texto} onChangeText={setTexto} placeholder="Mensagem" placeholderTextColor={cores.suave} multiline maxLength={500} />
        <Pressable style={[s.enviar, !texto.trim() && { opacity: 0.4 }]} onPress={enviar} disabled={!texto.trim()}>
          <Text style={s.enviarTexto}>Enviar</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  vazio: { textAlign: 'center', color: cores.suave, marginTop: 30 },
  balao: { maxWidth: '80%', borderRadius: 14, paddingVertical: 8, paddingHorizontal: 12 },
  meu: { alignSelf: 'flex-end', backgroundColor: cores.primaria },
  outro: { alignSelf: 'flex-start', backgroundColor: cores.cartao, borderWidth: 1, borderColor: cores.borda },
  suporte: { alignSelf: 'flex-start', backgroundColor: cores.alertaFundo, borderWidth: 1, borderColor: cores.alerta },
  autor: { fontSize: 11, fontWeight: '800', color: cores.suave, marginBottom: 2 },
  texto: { fontSize: 15, color: cores.texto },
  hora: { fontSize: 10, color: cores.suave, marginTop: 2, alignSelf: 'flex-end' },
  erro: { color: cores.erro, fontSize: 12, paddingHorizontal: 12 },
  barra: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 10, paddingTop: 8, backgroundColor: cores.cartao, borderTopWidth: 1, borderTopColor: cores.borda },
  input: { flex: 1, maxHeight: 120, backgroundColor: cores.fundo, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: cores.texto },
  enviar: { backgroundColor: cores.primaria, borderRadius: 18, paddingVertical: 10, paddingHorizontal: 16 },
  enviarTexto: { color: '#fff', fontWeight: '700' },
});
