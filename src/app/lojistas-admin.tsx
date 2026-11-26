import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { cores, raio, sombra } from '../components/tema';
import { cidadeDe, nomeCidade } from '../data/cidades';
import * as Admin from '../services/admin';
import { formatarCpf } from '../services/cpf';

const data = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const cnpj = (c: string) => c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');

/** Lojas cadastradas pelo app (perfil Lojista): aprovar antes de poderem chamar motoristas. */
export default function LojistasAdmin() {
  const [lista, setLista] = useState<Admin.LojistaAdmin[] | null>(null);

  const carregar = useCallback(async () => {
    try {
      setLista(await Admin.lojistas());
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

  async function mudar(l: Admin.LojistaAdmin, status: Admin.LojistaAdmin['status']) {
    try {
      await Admin.statusLojista(l.id, status);
      carregar();
    } catch (e) {
      Alert.alert('Erro', (e as Error).message);
    }
  }

  return (
    <ScrollView contentContainerStyle={s.conteudo} refreshControl={<RefreshControl refreshing={false} onRefresh={carregar} />}>
      {lista?.length === 0 && <Text style={s.vazio}>Nenhuma loja cadastrada ainda. As lojas se cadastram pelo app, no perfil Lojista.</Text>}
      {lista?.map((l) => (
        <View key={l.id} style={[s.cartao, l.status === 'pendente' && { borderColor: cores.alerta, borderWidth: 1.5 }]}>
          <View style={s.linha}>
            <Text style={s.nome}>{l.loja_nome}</Text>
            <Text style={[s.selo, { backgroundColor: l.status === 'aprovado' ? cores.sucesso : l.status === 'pendente' ? cores.alerta : cores.erro }]}>{l.status.toUpperCase()}</Text>
          </View>
          {l.cnpj ? <Text style={s.detalhe}>CNPJ {cnpj(l.cnpj)}</Text> : <Text style={s.detalhe}>Sem CNPJ informado</Text>}
          <Text style={s.detalhe}>
            Responsável: {l.nome} · CPF {formatarCpf(l.cpf)}
          </Text>
          <Text style={s.detalhe}>
            📍 {l.endereco} · {nomeCidade(cidadeDe(l))}
          </Text>
          <Text style={s.detalhe}>
            Desde {data(l.criado_em)} · {l.corridas} corrida(s) paga(s)
          </Text>
          <View style={s.botoes}>
            {l.telefone && (
              <Pressable style={s.mini} onPress={() => Linking.openURL(`https://wa.me/55${l.telefone}`)}>
                <Text style={s.miniTexto}>WhatsApp</Text>
              </Pressable>
            )}
            <Pressable style={s.mini} onPress={() => Admin.senhaProvisoria('lojistas', l.id, l.loja_nome)}>
              <Text style={s.miniTexto}>Senha provisória</Text>
            </Pressable>
            <Pressable style={s.mini} onPress={() => Linking.openURL(`https://www.openstreetmap.org/?mlat=${l.lat}&mlon=${l.lon}#map=18/${l.lat}/${l.lon}`)}>
              <Text style={s.miniTexto}>Mapa</Text>
            </Pressable>
            {l.status !== 'aprovado' && (
              <Pressable style={[s.mini, { backgroundColor: cores.sucessoFundo }]} onPress={() => mudar(l, 'aprovado')}>
                <Text style={[s.miniTexto, { color: cores.sucesso }]}>Aprovar</Text>
              </Pressable>
            )}
            {l.status !== 'bloqueado' && (
              <Pressable style={[s.mini, { backgroundColor: cores.erroFundo }]} onPress={() => mudar(l, 'bloqueado')}>
                <Text style={[s.miniTexto, { color: cores.erro }]}>Bloquear</Text>
              </Pressable>
            )}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  conteudo: { padding: 16, paddingBottom: 40, gap: 10 },
  vazio: { color: cores.suave, textAlign: 'center', marginTop: 20 },
  cartao: { backgroundColor: cores.cartao, borderRadius: raio, padding: 14, gap: 3, ...sombra },
  linha: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  nome: { fontSize: 17, fontWeight: '700', color: cores.texto, flexShrink: 1 },
  selo: { fontSize: 11, fontWeight: '700', color: '#fff', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, overflow: 'hidden' },
  detalhe: { fontSize: 14, color: cores.suave },
  botoes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  mini: { backgroundColor: cores.primariaClara, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 12 },
  miniTexto: { color: cores.texto, fontWeight: '700', fontSize: 13 },
});
