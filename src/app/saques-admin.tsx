import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { cores, raio, sombra } from '../components/tema';
import * as Admin from '../services/admin';
import { formatarCpf } from '../services/cpf';
import { formatarReais } from '../services/preco';

const data = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

/**
 * Ordens de saque dos motoristas. Você faz o Pix pelo app da InfinitePay (chave = CPF do motorista)
 * e marca a ordem como paga aqui; o motorista vê o status no app dele.
 */
export default function SaquesAdmin() {
  const [lista, setLista] = useState<Admin.SaqueAdmin[]>([]);

  const carregar = useCallback(async () => {
    try {
      setLista(await Admin.saques());
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

  async function acao(fn: () => Promise<unknown>) {
    try {
      await fn();
      await carregar();
    } catch (e) {
      Alert.alert('Não deu certo', (e as Error).message);
    }
  }

  const pendentes = lista.filter((q) => q.status === 'solicitado');
  const outros = lista.filter((q) => q.status !== 'solicitado');

  return (
    <ScrollView contentContainerStyle={s.conteudo} refreshControl={<RefreshControl refreshing={false} onRefresh={carregar} />}>
      <Text style={s.ajuda}>
        Para pagar: abra o app da InfinitePay → Pix → Pagar com chave → CPF do motorista → valor. Depois toque em “Marcar como pago”.
      </Text>
      <Text style={s.secao}>A pagar ({pendentes.length})</Text>
      {pendentes.length === 0 && <Text style={s.vazio}>Nenhum saque pendente.</Text>}
      {pendentes.map((q) => (
        <View key={q.id} style={[s.cartao, { borderColor: cores.alerta, borderWidth: 1.5 }]}>
          <View style={s.linha}>
            <Text style={s.nome}>{q.motorista_nome}</Text>
            <Text style={s.valor}>{formatarReais(q.valor)}</Text>
          </View>
          <Text style={s.detalhe}>Pedido em {data(q.criado_em)}</Text>
          <Text style={s.pix} selectable>
            Pix (CPF): {formatarCpf(q.chave_pix)}
          </Text>
          <View style={s.botoes}>
            <Mini texto="Copiar chave" onPress={() => Share.share({ message: q.chave_pix })} />
            <Mini
              texto="Marcar como pago"
              onPress={() =>
                Alert.alert('Confirmar', `Você já enviou ${formatarReais(q.valor)} por Pix para ${q.motorista_nome}?`, [
                  { text: 'Ainda não', style: 'cancel' },
                  { text: 'Sim, paguei', onPress: () => acao(() => Admin.pagarSaque(q.id)) },
                ])
              }
            />
            <Mini
              texto="Recusar"
              perigo
              onPress={() =>
                Alert.alert('Recusar saque?', 'O valor volta para o saldo do motorista.', [
                  { text: 'Voltar', style: 'cancel' },
                  { text: 'Recusar', style: 'destructive', onPress: () => acao(() => Admin.recusarSaque(q.id, 'Recusado pela administração')) },
                ])
              }
            />
          </View>
        </View>
      ))}

      {outros.length > 0 && <Text style={s.secao}>Histórico</Text>}
      {outros.map((q) => (
        <View key={q.id} style={s.cartao}>
          <View style={s.linha}>
            <Text style={s.nome}>{q.motorista_nome}</Text>
            <Text style={s.valor}>{formatarReais(q.valor)}</Text>
          </View>
          <Text style={s.detalhe}>
            {q.status === 'pago' ? `✓ Pago em ${data(q.pago_em!)}` : `✕ Recusado${q.motivo ? ` · ${q.motivo}` : ''}`}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}

function Mini({ texto, onPress, perigo }: { texto: string; onPress: () => void; perigo?: boolean }) {
  return (
    <Pressable onPress={onPress} style={[s.mini, perigo && { backgroundColor: cores.erroFundo }]}>
      <Text style={[s.miniTexto, perigo && { color: cores.erro }]}>{texto}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  conteudo: { padding: 16, paddingBottom: 40, gap: 10 },
  ajuda: { fontSize: 13, color: cores.suave },
  secao: { fontSize: 13, fontWeight: '700', color: cores.suave, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 8 },
  vazio: { color: cores.suave },
  cartao: { backgroundColor: cores.cartao, borderRadius: raio, ...sombra, padding: 14, gap: 3 },
  linha: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  nome: { fontSize: 16, fontWeight: '700', color: cores.texto, flexShrink: 1 },
  valor: { fontSize: 20, fontWeight: '700', color: cores.primaria },
  detalhe: { fontSize: 13, color: cores.suave },
  pix: { fontSize: 16, fontWeight: '700', color: cores.texto, marginTop: 4 },
  botoes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  mini: { backgroundColor: cores.primariaClara, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12 },
  miniTexto: { color: cores.primaria, fontWeight: '700', fontSize: 13 },
});
