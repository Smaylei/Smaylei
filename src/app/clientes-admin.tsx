import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { cores, raio } from '../components/tema';
import * as Admin from '../services/admin';
import { mascararCpf } from '../services/cpf';

/** Clientes cadastrados: contato e bloqueio. */
export default function ClientesAdmin() {
  const [lista, setLista] = useState<Admin.ClienteAdmin[]>([]);
  const [busca, setBusca] = useState('');

  const carregar = useCallback(async () => {
    try {
      setLista(await Admin.clientes());
    } catch (e) {
      Alert.alert('Erro', (e as Error).message);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      const t = setTimeout(carregar, 0);
      return () => clearTimeout(t);
    }, [carregar]),
  );

  const filtro = busca.trim().toLowerCase();
  const itens = filtro ? lista.filter((c) => `${c.nome} ${c.endereco} ${c.telefone ?? ''}`.toLowerCase().includes(filtro)) : lista;

  async function acao(id: string, a: 'bloquear' | 'desbloquear') {
    try {
      await Admin.acaoCliente(id, a);
      await carregar();
    } catch (e) {
      Alert.alert('Não deu certo', (e as Error).message);
    }
  }

  return (
    <ScrollView contentContainerStyle={s.conteudo} refreshControl={<RefreshControl refreshing={false} onRefresh={carregar} />}>
      <TextInput style={s.busca} value={busca} onChangeText={setBusca} placeholder="Buscar por nome, endereço ou telefone" placeholderTextColor={cores.suave} />
      <Text style={s.detalhe}>{lista.length} clientes</Text>
      {itens.map((c) => (
        <View key={c.id} style={[s.cartao, c.bloqueado ? { opacity: 0.6 } : null]}>
          <View style={s.linha}>
            <Text style={s.nome}>{c.nome}</Text>
            <Text style={s.detalhe}>{c.corridas} fretes</Text>
          </View>
          <Text style={s.detalhe}>
            CPF {mascararCpf(c.cpf)} · {c.telefone ?? 'sem telefone'}
          </Text>
          <Text style={s.detalhe}>📍 {c.endereco}</Text>
          <View style={s.botoes}>
            {!!c.telefone && <Mini texto="WhatsApp" onPress={() => Linking.openURL(`https://wa.me/55${c.telefone!.replace(/\D/g, '').replace(/^55/, '')}`)} />}
            {c.bloqueado ? <Mini texto="Desbloquear" onPress={() => acao(c.id, 'desbloquear')} /> : <Mini texto="Bloquear" perigo onPress={() => acao(c.id, 'bloquear')} />}
          </View>
        </View>
      ))}
    </ScrollView>
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
  busca: { backgroundColor: cores.cartao, borderWidth: 1, borderColor: cores.borda, borderRadius: raio, padding: 12, fontSize: 15, color: cores.texto },
  cartao: { backgroundColor: cores.cartao, borderRadius: raio, borderWidth: 1, borderColor: cores.borda, padding: 14, gap: 2 },
  linha: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  nome: { fontSize: 16, fontWeight: '800', color: cores.texto, flexShrink: 1 },
  detalhe: { fontSize: 13, color: cores.suave },
  botoes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  mini: { borderWidth: 1, borderColor: cores.primaria, borderRadius: 10, paddingVertical: 7, paddingHorizontal: 10 },
  miniTexto: { color: cores.primaria, fontWeight: '700', fontSize: 13 },
});
