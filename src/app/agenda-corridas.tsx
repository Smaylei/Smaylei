import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { cores, raio, sombra } from '../components/tema';
import { api, type CorridaMotorista } from '../services/api';
import { formatarReais } from '../services/preco';

type Dia = { data: string; rotulo: string; corridas: CorridaMotorista[] };
const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

/**
 * Agenda de corridas: fretes agendados (já pagos pelo cliente) ainda sem motorista, por dia.
 * O parceiro escolhe o dia, aceita, e a corrida vai para "Minha agenda".
 */
export default function AgendaCorridas() {
  const [dias, setDias] = useState<Dia[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const d = await api<Dia[]>('motorista', '/v2/agenda-disponivel');
      setDias(d);
      setSel((atual) => (atual && d.some((x) => x.data === atual) ? atual : (d[0]?.data ?? null)));
    } catch (e) {
      Alert.alert('Erro', (e as Error).message);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      const t0 = setTimeout(carregar, 0);
      const t = setInterval(carregar, 15_000);
      return () => {
        clearTimeout(t0);
        clearInterval(t);
      };
    }, [carregar]),
  );

  async function aceitar(c: CorridaMotorista) {
    setOcupado(c.id);
    try {
      await api('motorista', `/v2/ofertas/${c.id}/aceitar`, { method: 'POST' });
      Alert.alert('Corrida aceita', `${c.janela} · ${c.mercado?.nome}\nEla está em Minha agenda e na agenda do celular.`, [
        { text: 'Ver minha agenda', onPress: () => router.push('/agenda-motorista') },
        { text: 'Continuar aqui' },
      ]);
      await carregar();
    } catch (e) {
      Alert.alert('Não foi possível', (e as Error).message);
      carregar();
    } finally {
      setOcupado(null);
    }
  }

  if (!dias) return <ActivityIndicator style={{ marginTop: 60 }} color={cores.primaria} />;
  const dia = dias.find((d) => d.data === sel);

  return (
    <ScrollView contentContainerStyle={s.conteudo} refreshControl={<RefreshControl refreshing={false} onRefresh={carregar} />}>
      {dias.length === 0 ? (
        <Text style={s.vazio}>Nenhuma corrida agendada disponível agora. Quando um cliente agendar e pagar, ela aparece aqui.</Text>
      ) : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {dias.map((d) => (
              <Pressable key={d.data} onPress={() => setSel(d.data)} style={[s.dia, sel === d.data && s.diaAtivo]}>
                <Text style={[s.diaTexto, sel === d.data && { color: '#fff' }]}>{d.rotulo}</Text>
                <Text style={[s.diaQtd, sel === d.data && { color: cores.sobrePrimaria }]}>
                  {d.corridas.length} corrida{d.corridas.length > 1 ? 's' : ''}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          {dia?.corridas.map((c) => (
            <View key={c.id} style={s.cartao}>
              <View style={s.linha}>
                <Text style={s.hora}>{hora(c.inicio)}</Text>
                <Text style={s.ganho}>{formatarReais(c.ganho)}</Text>
              </View>
              <Text style={s.texto}>🛒 Coleta: {c.mercado?.nome}</Text>
              <Text style={s.texto}>📍 Entrega: {c.cliente?.endereco}</Text>
              <Text style={s.detalhe}>
                Ida e volta {c.km.toFixed(1).replace('.', ',')} km · ~{c.minutos} min
              </Text>
              <Pressable style={s.botao} onPress={() => aceitar(c)} disabled={!!ocupado}>
                {ocupado === c.id ? <ActivityIndicator color="#fff" /> : <Text style={s.botaoTexto}>Aceitar para {dia.rotulo.toLowerCase()}</Text>}
              </Pressable>
            </View>
          ))}
        </>
      )}
      <Pressable onPress={() => router.push('/agenda-motorista')}>
        <Text style={s.link}>Minha agenda ›</Text>
      </Pressable>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  conteudo: { padding: 16, paddingBottom: 40, gap: 10 },
  vazio: { color: cores.suave, fontSize: 14, textAlign: 'center', marginTop: 16 },
  dia: { ...sombra, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 14, backgroundColor: cores.cartao, alignItems: 'center' },
  diaAtivo: { backgroundColor: cores.primaria, borderColor: cores.primaria },
  diaTexto: { fontSize: 14, fontWeight: '700', color: cores.texto },
  diaQtd: { fontSize: 11, color: cores.suave },
  cartao: { backgroundColor: cores.cartao, borderRadius: raio, ...sombra, padding: 14, gap: 4 },
  linha: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  hora: { fontSize: 22, fontWeight: '700', color: cores.texto },
  ganho: { fontSize: 22, fontWeight: '700', color: cores.primaria },
  texto: { fontSize: 15, color: cores.texto },
  detalhe: { fontSize: 13, color: cores.suave },
  botao: { backgroundColor: cores.primaria, borderRadius: raio, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  botaoTexto: { color: '#fff', fontSize: 16, fontWeight: '700' },
  link: { color: cores.primaria, fontWeight: '700', fontSize: 15, textAlign: 'center', paddingVertical: 8 },
});
