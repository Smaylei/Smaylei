import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { cores, raio } from '../components/tema';
import { api, type Saldo } from '../services/api';
import { formatarCpf } from '../services/cpf';
import { formatarReais } from '../services/preco';

type Detalhe = Saldo & {
  chavePix: string;
  saqueDias: number;
  creditos: { id: string; tipo: 'corrida' | 'taxa'; valor: number; criadoEm: string; mercado: string | null }[];
  saques: { id: string; valor: number; status: 'solicitado' | 'pago' | 'recusado'; criadoEm: string; pagoEm: string | null; motivo: string | null }[];
};

const data = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });
const ROTULO_SAQUE = { solicitado: '⏳ Solicitado', pago: '✓ Pago', recusado: '✕ Recusado' };

/** Saldo do motorista: o que já foi liberado, o que está em liberação e os saques semanais por Pix. */
export default function SaldoMotorista() {
  const [d, setD] = useState<Detalhe | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setD(await api<Detalhe>('motorista', '/v2/saldo'));
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

  function sacar() {
    if (!d) return;
    Alert.alert('Pedir saque', `Enviar ${formatarReais(d.disponivel)} para o Pix (CPF ${formatarCpf(d.chavePix)})?`, [
      { text: 'Voltar', style: 'cancel' },
      {
        text: 'Pedir saque',
        onPress: async () => {
          setOcupado(true);
          try {
            await api('motorista', '/v2/saques', { method: 'POST' });
            Alert.alert('Saque solicitado', 'A administração faz o Pix e você vê aqui quando for pago.');
            await carregar();
          } catch (e) {
            Alert.alert('Não foi possível', (e as Error).message);
          } finally {
            setOcupado(false);
          }
        },
      },
    ]);
  }

  if (!d) return <ActivityIndicator style={{ marginTop: 60 }} color={cores.primaria} />;
  const podeSacar = d.disponivel >= 1 && !d.proximoSaqueEm;

  return (
    <ScrollView contentContainerStyle={s.conteudo} refreshControl={<RefreshControl refreshing={false} onRefresh={carregar} />}>
      <View style={s.saldo}>
        <Text style={s.rotulo}>Disponível para saque</Text>
        <Text style={s.valor}>{formatarReais(d.disponivel)}</Text>
        <Text style={s.sub}>Em liberação: {formatarReais(d.emLiberacao)} · Total já ganho: {formatarReais(d.totalGanho)}</Text>
      </View>

      <Pressable style={[s.botao, (!podeSacar || ocupado) && { opacity: 0.45 }]} disabled={!podeSacar || ocupado} onPress={sacar}>
        {ocupado ? <ActivityIndicator color="#fff" /> : <Text style={s.botaoTexto}>Pedir saque</Text>}
      </Pressable>
      <Text style={s.ajuda}>
        {d.proximoSaqueEm
          ? `Saques são semanais: o próximo pode ser pedido em ${data(d.proximoSaqueEm)}.`
          : `1 saque a cada ${d.saqueDias} dias, por Pix na chave CPF ${formatarCpf(d.chavePix)}.`}
      </Text>
      <Text style={s.ajuda}>Cada corrida entra no saldo quando o cliente confirma que você chegou ao local da coleta.</Text>

      <Text style={s.secao}>Saques</Text>
      {d.saques.length === 0 && <Text style={s.vazio}>Nenhum saque ainda.</Text>}
      {d.saques.map((q) => (
        <View key={q.id} style={s.item}>
          <View style={{ flex: 1 }}>
            <Text style={s.texto}>{ROTULO_SAQUE[q.status]}</Text>
            <Text style={s.detalhe}>
              Pedido em {data(q.criadoEm)}
              {q.pagoEm ? ` · pago em ${data(q.pagoEm)}` : ''}
              {q.motivo ? ` · ${q.motivo}` : ''}
            </Text>
          </View>
          <Text style={s.itemValor}>{formatarReais(q.valor)}</Text>
        </View>
      ))}

      <Text style={s.secao}>Ganhos</Text>
      {d.creditos.length === 0 && <Text style={s.vazio}>As corridas confirmadas aparecem aqui.</Text>}
      {d.creditos.map((c) => (
        <View key={c.id} style={s.item}>
          <View style={{ flex: 1 }}>
            <Text style={s.texto}>{c.tipo === 'taxa' ? 'Taxa de deslocamento' : `Corrida · ${c.mercado ?? ''}`}</Text>
            <Text style={s.detalhe}>{data(c.criadoEm)}</Text>
          </View>
          <Text style={[s.itemValor, { color: cores.primaria }]}>+ {formatarReais(c.valor)}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  conteudo: { padding: 16, paddingBottom: 40, gap: 10 },
  saldo: { backgroundColor: cores.primaria, borderRadius: raio, padding: 18 },
  rotulo: { color: '#D7F0E1', fontSize: 13, fontWeight: '700' },
  valor: { color: '#fff', fontSize: 34, fontWeight: '800', fontVariant: ['tabular-nums'] },
  sub: { color: '#D7F0E1', fontSize: 13 },
  botao: { backgroundColor: cores.primaria, borderRadius: raio, paddingVertical: 16, alignItems: 'center' },
  botaoTexto: { color: '#fff', fontSize: 17, fontWeight: '800' },
  ajuda: { fontSize: 12, color: cores.suave, textAlign: 'center' },
  secao: { fontSize: 13, fontWeight: '800', color: cores.suave, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 10 },
  vazio: { color: cores.suave, fontSize: 14 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: cores.cartao, borderRadius: raio, borderWidth: 1, borderColor: cores.borda, padding: 12 },
  texto: { fontSize: 15, fontWeight: '600', color: cores.texto },
  detalhe: { fontSize: 12, color: cores.suave },
  itemValor: { fontSize: 16, fontWeight: '800', color: cores.texto },
});
