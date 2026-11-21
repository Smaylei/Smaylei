import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text } from 'react-native';
import { cores, raio, sombra } from '../components/tema';
import * as Admin from '../services/admin';

const data = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

/** Avisos internos (substituem o WhatsApp): pedidos pagos, aceites, cancelamentos, saques, mensagens, motoristas novos. */
export default function AvisosAdmin() {
  const [lista, setLista] = useState<Admin.Aviso[]>([]);

  const carregar = useCallback(async () => {
    try {
      const r = await Admin.avisos();
      setLista(r.avisos);
      if (r.naoLidos > 0) await Admin.avisosLidos();
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

  return (
    <ScrollView contentContainerStyle={s.conteudo} refreshControl={<RefreshControl refreshing={false} onRefresh={carregar} />}>
      {lista.length === 0 && <Text style={s.vazio}>Nenhum aviso ainda.</Text>}
      {lista.map((a) => (
        <Pressable
          key={a.id}
          style={[s.cartao, !a.lido && s.novo]}
          disabled={!a.corridaId}
          onPress={() => a.corridaId && router.push(`/chat/${a.corridaId}`)}
        >
          <Text style={s.data}>{data(a.criadoEm)}</Text>
          <Text style={s.texto}>{a.texto}</Text>
          {a.corridaId && <Text style={s.link}>Abrir chat da corrida ›</Text>}
        </Pressable>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  conteudo: { padding: 16, paddingBottom: 40, gap: 8 },
  vazio: { textAlign: 'center', color: cores.suave, marginTop: 20 },
  cartao: { backgroundColor: cores.cartao, borderRadius: raio, ...sombra, padding: 12, gap: 4 },
  novo: { borderColor: cores.primaria, borderWidth: 1.5 },
  data: { fontSize: 11, color: cores.suave, fontWeight: '700' },
  texto: { fontSize: 14, color: cores.texto },
  link: { fontSize: 13, color: cores.primaria, fontWeight: '700' },
});
