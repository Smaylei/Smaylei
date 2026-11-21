import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { cores, raio, sombra } from '../components/tema';
import * as Admin from '../services/admin';
import { formatarReais } from '../services/preco';

const data = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
const estrelas = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);
type Filtro = 'todas' | 'sugestoes' | 'baixas';

/** Avaliações do fim de cada atendimento e a caixa de sugestões: só a administração vê. */
export default function AvaliacoesAdmin() {
  const [d, setD] = useState<Admin.Avaliacoes | null>(null);
  const [filtro, setFiltro] = useState<Filtro>('todas');

  const carregar = useCallback(async () => {
    try {
      const r = await Admin.avaliacoes();
      setD(r);
      if (r.avaliacoes.some((a) => !a.lida)) await Admin.avaliacoesLidas();
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

  const lista = (d?.avaliacoes ?? []).filter((a) => (filtro === 'sugestoes' ? !!a.sugestao : filtro === 'baixas' ? a.nota <= 3 : true));

  return (
    <ScrollView contentContainerStyle={s.conteudo} refreshControl={<RefreshControl refreshing={false} onRefresh={carregar} />}>
      <View style={s.numeros}>
        <View style={s.numero}>
          <Text style={s.numeroValor}>{d?.media != null ? d.media.toFixed(1).replace('.', ',') : '—'}</Text>
          <Text style={s.numeroRotulo}>nota média ({d?.total ?? 0})</Text>
        </View>
        <View style={s.numero}>
          <Text style={s.numeroValor}>{d?.comSugestao ?? 0}</Text>
          <Text style={s.numeroRotulo}>sugestões</Text>
        </View>
        <View style={s.numero}>
          <Text style={s.numeroValor}>{formatarReais(d?.gorjetas.total ?? 0)}</Text>
          <Text style={s.numeroRotulo}>gorjetas ({d?.gorjetas.quantidade ?? 0})</Text>
        </View>
      </View>

      <View style={s.filtros}>
        {(
          [
            ['todas', 'Todas'],
            ['sugestoes', 'Com sugestão'],
            ['baixas', 'Notas até 3'],
          ] as [Filtro, string][]
        ).map(([id, t]) => (
          <Pressable key={id} style={[s.filtro, filtro === id && s.filtroAtivo]} onPress={() => setFiltro(id)}>
            <Text style={[s.filtroTexto, filtro === id && { color: cores.primaria }]}>{t}</Text>
          </Pressable>
        ))}
      </View>

      {d && lista.length === 0 && <Text style={s.vazio}>Nada por aqui ainda.</Text>}
      {lista.map((a) => (
        <Pressable key={a.corridaId} style={[s.cartao, !a.lida && s.novo]} onPress={() => router.push(`/chat/${a.corridaId}`)}>
          <View style={s.linha}>
            <Text style={[s.estrelas, { color: a.nota <= 2 ? cores.erro : cores.estrela }]}>{estrelas(a.nota)}</Text>
            <Text style={s.data}>{data(a.criadoEm)}</Text>
          </View>
          <Text style={s.quem}>
            {a.clienteNome} → {a.motoristaNome ?? 'motorista'} · {a.mercado} · {formatarReais(a.valor)}
          </Text>
          {a.gorjeta ? <Text style={s.gorjeta}>💚 Gorjeta {formatarReais(a.gorjeta)}</Text> : null}
          {a.sugestao ? (
            <View style={s.sugestao}>
              <Text style={s.sugestaoRotulo}>💡 Sugestão</Text>
              <Text style={s.sugestaoTexto}>{a.sugestao}</Text>
            </View>
          ) : null}
        </Pressable>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  conteudo: { padding: 16, paddingBottom: 40, gap: 10 },
  numeros: { flexDirection: 'row', gap: 8 },
  numero: { flex: 1, backgroundColor: cores.cartao, borderRadius: raio, padding: 12, ...sombra },
  numeroValor: { fontSize: 18, fontWeight: '700', color: cores.texto },
  numeroRotulo: { fontSize: 12, color: cores.suave },
  filtros: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  filtro: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: cores.cartao, borderWidth: 1, borderColor: cores.borda },
  filtroAtivo: { backgroundColor: cores.primariaClara, borderColor: cores.primaria },
  filtroTexto: { fontSize: 14, fontWeight: '600', color: cores.texto },
  vazio: { textAlign: 'center', color: cores.suave, marginTop: 20 },
  cartao: { backgroundColor: cores.cartao, borderRadius: raio, padding: 14, gap: 4, ...sombra },
  novo: { borderWidth: 1.5, borderColor: cores.primaria },
  linha: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  estrelas: { fontSize: 18, letterSpacing: 1 },
  data: { fontSize: 12, color: cores.suave },
  quem: { fontSize: 14, color: cores.texto },
  gorjeta: { fontSize: 13, color: cores.sucesso, fontWeight: '700' },
  sugestao: { backgroundColor: cores.primariaClara, borderRadius: 12, padding: 10, marginTop: 4, gap: 2 },
  sugestaoRotulo: { fontSize: 12, fontWeight: '700', color: cores.primaria },
  sugestaoTexto: { fontSize: 14, color: cores.texto, lineHeight: 20 },
});
