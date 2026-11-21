import { useFocusEffect } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { cores, raio, sombra } from '../components/tema';
import * as Admin from '../services/admin';
import { formatarReais } from '../services/preco';

const data = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
const MOTIVO: Record<string, string> = {
  sem_motorista: 'nenhum motorista aceitou',
  cliente_cancelou: 'cliente cancelou',
  cliente_ausente: 'cliente não apareceu',
  admin: 'cancelada por você',
};

/**
 * Devoluções a fazer: pagamentos retidos de corridas canceladas antes de liberar ao motorista.
 * A InfinitePay não tem API de estorno: faça pelo app dela (Vendas → a venda → Estornar) e marque aqui.
 */
export default function EstornosAdmin() {
  const [lista, setLista] = useState<Admin.EstornoAdmin[]>([]);

  const carregar = useCallback(async () => {
    try {
      setLista(await Admin.estornos());
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

  const pendentes = lista.filter((e) => !e.reembolsado_em);
  const feitos = lista.filter((e) => e.reembolsado_em);

  return (
    <ScrollView contentContainerStyle={s.conteudo} refreshControl={<RefreshControl refreshing={false} onRefresh={carregar} />}>
      <Text style={s.ajuda}>Para estornar: app da InfinitePay → Vendas → abra a venda (comprovante abaixo) → Estornar o valor indicado. Depois marque aqui.</Text>
      <Text style={s.secao}>A fazer ({pendentes.length})</Text>
      {pendentes.length === 0 && <Text style={s.vazio}>Nenhum estorno pendente.</Text>}
      {pendentes.map((e) => (
        <View key={e.id} style={[s.cartao, { borderColor: cores.alerta, borderWidth: 1.5 }]}>
          <View style={s.linha}>
            <Text style={s.nome}>{e.cliente_nome}</Text>
            <Text style={s.valor}>{formatarReais(e.reembolso)}</Text>
          </View>
          <Text style={s.detalhe}>
            {e.mercado_nome} · pago {formatarReais(e.valor)} ({e.metodo === 'pix' ? 'Pix' : 'cartão'}) · {MOTIVO[e.motivo ?? ''] ?? e.motivo}
            {e.taxa_aplicada > 0 ? ` · taxa ${formatarReais(e.taxa_aplicada)} ficou com o motorista` : ''}
          </Text>
          {e.cancelado_em && <Text style={s.detalhe}>Cancelada em {data(e.cancelado_em)}</Text>}
          <View style={s.botoes}>
            {e.receipt_url && <Mini texto="Comprovante" onPress={() => WebBrowser.openBrowserAsync(e.receipt_url!)} />}
            <Mini
              texto="Marcar estornado"
              onPress={() =>
                Alert.alert('Confirmar', `Você já estornou ${formatarReais(e.reembolso)} para ${e.cliente_nome}?`, [
                  { text: 'Ainda não', style: 'cancel' },
                  {
                    text: 'Sim',
                    onPress: () =>
                      Admin.estornoFeito(e.id)
                        .then(carregar)
                        .catch((x) => Alert.alert('Erro', (x as Error).message)),
                  },
                ])
              }
            />
          </View>
        </View>
      ))}
      {feitos.length > 0 && <Text style={s.secao}>Feitos</Text>}
      {feitos.map((e) => (
        <View key={e.id} style={s.cartao}>
          <View style={s.linha}>
            <Text style={s.nome}>{e.cliente_nome}</Text>
            <Text style={s.valor}>{formatarReais(e.reembolso)}</Text>
          </View>
          <Text style={s.detalhe}>✓ Estornado em {data(e.reembolsado_em!)}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

function Mini({ texto, onPress }: { texto: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={s.mini}>
      <Text style={s.miniTexto}>{texto}</Text>
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
  valor: { fontSize: 20, fontWeight: '700', color: cores.erro },
  detalhe: { fontSize: 13, color: cores.suave },
  botoes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  mini: { backgroundColor: cores.primariaClara, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12 },
  miniTexto: { color: cores.primaria, fontWeight: '700', fontSize: 13 },
});
