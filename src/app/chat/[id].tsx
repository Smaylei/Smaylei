import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { cores } from '../../components/tema';
import { api, type Mensagem } from '../../services/api';
import { VARIANTE } from '../../variante';

/** Chat da corrida entre cliente e motorista (o mesmo componente nos dois apps). */
export default function Chat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const papel = VARIANTE === 'motorista' ? 'motorista' : 'cliente';
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
      juntar(await api<Mensagem[]>(papel, `/v2/corridas/${id}/mensagens?depois=${ultimo.current}`));
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [id, papel, juntar]);

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
      juntar(await api<Mensagem[]>(papel, `/v2/corridas/${id}/mensagens?depois=${ultimo.current}`, { method: 'POST', corpo: { texto: t } }));
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
        ListEmptyComponent={<Text style={s.vazio}>Combine detalhes da entrega por aqui.</Text>}
        renderItem={({ item }) => {
          const meu = item.autor === papel;
          return (
            <View style={[s.balao, meu ? s.meu : s.outro]}>
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
  texto: { fontSize: 15, color: cores.texto },
  hora: { fontSize: 10, color: cores.suave, marginTop: 2, alignSelf: 'flex-end' },
  erro: { color: cores.erro, fontSize: 12, paddingHorizontal: 12 },
  barra: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 10, paddingTop: 8, backgroundColor: cores.cartao, borderTopWidth: 1, borderTopColor: cores.borda },
  input: { flex: 1, maxHeight: 120, backgroundColor: cores.fundo, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: cores.texto },
  enviar: { backgroundColor: cores.primaria, borderRadius: 18, paddingVertical: 10, paddingHorizontal: 16 },
  enviarTexto: { color: '#fff', fontWeight: '700' },
});
