import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { cores, raio } from '../components/tema';
import * as Admin from '../services/admin';
import { formatarReais } from '../services/preco';
import { comTaxa } from '../services/taxas';

const num = (t: string) => Number(String(t).replace(',', '.')) || 0;

const SITUACAO: Record<string, string> = {
  active: 'Ativa', registration: 'Falta a prova de vida', affiliation: 'Em análise', refused: 'Recusada', suspended: 'Suspensa', blocked: 'Bloqueada', inactive: 'Inativa',
};

/** Pagamentos: escolher InfinitePay ou Pagar.me, dados da Pagar.me e as contas de recebimento. */
export default function PagamentosAdmin() {
  const { width } = useWindowDimensions();
  const largo = width >= 900;
  const [d, setD] = useState<Admin.PagamentosAdmin | null>(null);
  const [f, setF] = useState({ recebedor: '', chave: '', prazo: '3', pixPct: '0', pixFixo: '0', cartaoPct: '0', cartaoFixo: '0', debitoPct: '0', debitoFixo: '0' });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const x = await Admin.pagamentos();
      setD(x);
      const t = (v: number) => String(v ?? 0).replace('.', ',');
      setF({
        recebedor: x.recebedorMovi, chave: x.chavePublica, prazo: String(x.pagarAoAceitarMin),
        pixPct: t(x.taxaPixPct), pixFixo: t(x.taxaPixFixo), cartaoPct: t(x.taxaCartaoPct), cartaoFixo: t(x.taxaCartaoFixo),
        debitoPct: t(x.taxaDebitoPct), debitoFixo: t(x.taxaDebitoFixo),
      });
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      const t = setTimeout(carregar, 0);
      return () => clearTimeout(t);
    }, [carregar]),
  );

  if (!d) return erro ? <Text style={[s.erro, { padding: 20 }]}>{erro}</Text> : <ActivityIndicator style={{ marginTop: 60 }} color={cores.primaria} />;

  async function salvar(gateway?: 'infinitepay' | 'pagarme') {
    setSalvando(true);
    try {
      await Admin.salvarConfig({
        pagarmeRecebedorMovi: f.recebedor.trim(), pagarmeChavePublica: f.chave.trim(), pagarAoAceitarMin: Math.round(Number(f.prazo)),
        taxaPixPct: num(f.pixPct), taxaPixFixo: num(f.pixFixo), taxaCartaoPct: num(f.cartaoPct), taxaCartaoFixo: num(f.cartaoFixo),
        taxaDebitoPct: num(f.debitoPct), taxaDebitoFixo: num(f.debitoFixo),
        ...(gateway ? { gateway } : {}),
      });
      await carregar();
      if (gateway) Alert.alert('Pagamentos', gateway === 'pagarme' ? 'Pagar.me ligada: os próximos pagamentos já usam Pix e cartão dentro do app.' : 'Voltamos para a InfinitePay.');
    } catch (e) {
      Alert.alert('Pagamentos', (e as Error).message);
    } finally {
      setSalvando(false);
    }
  }
  async function atualizar() {
    try {
      const r = await Admin.atualizarRecebedores();
      await carregar();
      Alert.alert('Contas de recebimento', `${r.atualizados} conta(s) mudaram de situação.`);
    } catch (e) {
      Alert.alert('Contas de recebimento', (e as Error).message);
    }
  }
  // Preço ao cliente: a maior taxa entre os meios ligados, embutida (igual em qualquer meio).
  const maior = (k: 'Pct' | 'Fixo') => Math.max(num(f[`pix${k}`]), num(f[`cartao${k}`]), d.debitoAtivo ? num(f[`debito${k}`]) : 0);
  const exemplo = comTaxa(50, { pct: maior('Pct'), fixo: maior('Fixo') }).total;
  async function debito(ativo: boolean) {
    setSalvando(true);
    try {
      await Admin.salvarConfig({ debitoAtivo: ativo });
      await carregar();
    } catch (e) {
      Alert.alert('Débito', (e as Error).message);
    } finally {
      setSalvando(false);
    }
  }
  const campoTaxa = (rotulo: string, k: 'pixPct' | 'pixFixo' | 'cartaoPct' | 'cartaoFixo' | 'debitoPct' | 'debitoFixo', sufixo: string) => (
    <View style={[s.campo, { maxWidth: largo ? 170 : undefined }]}>
      <Text style={s.rotulo}>{rotulo}</Text>
      <View style={s.linhaConta}>
        <TextInput style={[s.input, { flex: 1 }]} value={f[k]} onChangeText={(t) => setF({ ...f, [k]: t })} keyboardType="decimal-pad" />
        <Text style={s.sub}>{sufixo}</Text>
      </View>
    </View>
  );
  const lista = (titulo: string, itens: Admin.RecebedorAdmin[]) => (
    <View style={{ flex: 1, gap: 8 }}>
      <Text style={s.secao}>{titulo}</Text>
      {itens.map((r) => (
        <View key={r.id} style={s.linhaConta}>
          <Text style={[s.item, { flex: 1 }]} numberOfLines={1}>
            {r.loja_nome || r.nome}
          </Text>
          <Text style={[s.etiqueta, { color: r.pagarme_status === 'active' ? cores.sucesso : r.pagarme_recebedor ? cores.alerta : cores.apagado }]}>
            {r.pagarme_recebedor ? (SITUACAO[r.pagarme_status ?? ''] ?? r.pagarme_status ?? '—') : 'Sem conta'}
          </Text>
        </View>
      ))}
      {!itens.length && <Text style={s.sub}>Nenhum cadastro aprovado.</Text>}
    </View>
  );

  return (
    <ScrollView contentContainerStyle={s.conteudo} refreshControl={<RefreshControl refreshing={false} onRefresh={carregar} tintColor={cores.primaria} />}>
      <View style={s.cartao}>
        <Text style={s.titulo}>Quem processa os pagamentos</Text>
        <View style={s.abas}>
          {(['infinitepay', 'pagarme'] as const).map((g) => (
            <Pressable key={g} style={[s.aba, d.gateway === g && s.abaAtiva]} disabled={salvando || d.gateway === g} onPress={() => salvar(g)}>
              <Text style={[s.abaTexto, d.gateway === g && { color: '#fff' }]}>{g === 'infinitepay' ? 'InfinitePay (link)' : 'Pagar.me (split)'}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={s.sub}>
          {d.gateway === 'pagarme'
            ? `Pagar.me ligada (${d.ambiente ?? '—'}). Pedido para agora: o cliente paga quando o motorista aceita (até ${d.pagarAoAceitarMin} min) e o ganho vai direto para a conta dele. Delivery: os produtos vão direto para a loja. Estornos automáticos.`
            : 'InfinitePay: o cliente paga num link e a MOVI recebe tudo; repasses e estornos manuais.'}
        </Text>
        <View style={[s.chave, { borderColor: d.chaveConfigurada ? cores.sucesso : cores.alerta }]}>
          <Text style={s.item}>{d.chaveConfigurada ? `✓ Chave secreta configurada (${d.ambiente})` : '⚠️ Falta a chave secreta da Pagar.me'}</Text>
          {!d.chaveConfigurada && (
            <Text style={s.sub}>
              Na Cloudflare: Workers → mercado-frete-pagamentos → Settings → Variables and Secrets → Add → tipo Secret, nome PAGARME_SECRET_KEY, valor sk_... (da dashboard da Pagar.me). Nunca envie essa chave por chat.
            </Text>
          )}
        </View>
      </View>

      <View style={s.cartao}>
        <Text style={s.titulo}>Dados da Pagar.me</Text>
        <View style={[s.campos, !largo && { flexDirection: 'column' }]}>
          <View style={s.campo}>
            <Text style={s.rotulo}>Recebedor da MOVI (rp_...)</Text>
            <TextInput style={s.input} value={f.recebedor} onChangeText={(t) => setF({ ...f, recebedor: t })} autoCapitalize="none" placeholder="rp_XXXXXXXXXXXXXXXX" placeholderTextColor={cores.apagado} />
          </View>
          <View style={s.campo}>
            <Text style={s.rotulo}>Chave pública (pk_...)</Text>
            <TextInput style={s.input} value={f.chave} onChangeText={(t) => setF({ ...f, chave: t })} autoCapitalize="none" placeholder="pk_XXXXXXXXXXXXXXXX" placeholderTextColor={cores.apagado} />
          </View>
          <View style={[s.campo, { maxWidth: largo ? 200 : undefined }]}>
            <Text style={s.rotulo}>Minutos para pagar após o aceite</Text>
            <TextInput style={s.input} value={f.prazo} onChangeText={(t) => setF({ ...f, prazo: t })} keyboardType="number-pad" />
          </View>
          <Pressable style={s.ok} disabled={salvando} onPress={() => salvar()}>
            <Text style={s.okTexto}>Salvar</Text>
          </Pressable>
        </View>
        <Text style={s.rotulo}>Webhook para cadastrar na dashboard da Pagar.me (eventos order.paid, charge.paid, charge.refunded, charge.payment_failed):</Text>
        <Text selectable style={s.codigo}>
          {d.webhook}
        </Text>
        <Text style={s.sub}>O recebedor da MOVI fica em Pagar.me → Recebedores (o recebedor padrão da conta). O split com Pix precisa estar liberado pela Pagar.me na sua conta.</Text>
      </View>

      <View style={s.cartao}>
        <Text style={s.titulo}>Taxas do pagamento (embutidas no preço)</Text>
        <Text style={s.sub}>
          O cliente vê um preço só, igual no Pix, no crédito e no débito, com a maior destas taxas já dentro. Ele não vê a palavra “taxa”: no delivery ela entra na entrega. O motorista recebe o ganho
          mostrado, a loja recebe os produtos e a MOVI a parte dela, sem desconto; quando o cliente paga num meio mais barato (Pix), a diferença fica com a MOVI. Gorjeta e mensalidade não têm acréscimo.
          Use as taxas do seu contrato com a Pagar.me (no crédito, inclua a antecipação, se usar).
        </Text>
        <View style={[s.campos, !largo && { flexDirection: 'column' }]}>
          {campoTaxa('Pix', 'pixPct', '%')}
          {campoTaxa('Pix (fixo por venda)', 'pixFixo', 'R$')}
          {campoTaxa('Crédito à vista', 'cartaoPct', '%')}
          {campoTaxa('Crédito (fixo por venda)', 'cartaoFixo', 'R$')}
          {campoTaxa('Débito', 'debitoPct', '%')}
          {campoTaxa('Débito (fixo por venda)', 'debitoFixo', 'R$')}
          <Pressable style={s.ok} disabled={salvando} onPress={() => salvar()}>
            <Text style={s.okTexto}>Salvar</Text>
          </Pressable>
        </View>
        <Text style={s.sub}>
          Exemplo: um frete de {formatarReais(50)} aparece para o cliente como {formatarReais(exemplo)}, em qualquer meio de pagamento.
        </Text>
      </View>

      <View style={s.cartao}>
        <View style={s.linhaConta}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={s.titulo}>Cartão de débito</Text>
            <Text style={s.sub}>
              Visa e Mastercard, com a confirmação do banco (3DS) dentro do app. Ligue só depois que a Pagar.me liberar o débito e o 3DS na sua conta e de um teste no ambiente de teste.
            </Text>
          </View>
          <Switch value={d.debitoAtivo} disabled={salvando} onValueChange={debito} trackColor={{ true: cores.primaria }} />
        </View>
        <Text style={s.sub}>Crédito: o cliente pode salvar o cartão para as próximas compras (fica guardado na Pagar.me; a MOVI guarda só a bandeira e o final).</Text>
      </View>

      {d.estornosComErro.length > 0 && (
        <View style={[s.cartao, { borderColor: cores.alerta }]}>
          <Text style={s.titulo}>Estornos automáticos com erro</Text>
          {d.estornosComErro.map((x) => (
            <Text key={x.id} style={s.sub}>
              {x.id} · {formatarReais(x.reembolso)} · {x.estorno_erro}
            </Text>
          ))}
          <Text style={s.sub}>O sistema tenta de novo a cada 10 minutos. Se continuar, faça o estorno pela dashboard e marque em Estornos.</Text>
        </View>
      )}

      <View style={s.cartao}>
        <View style={s.linhaConta}>
          <Text style={[s.titulo, { flex: 1 }]}>Contas de recebimento</Text>
          <Pressable style={s.ok} onPress={atualizar}>
            <Text style={s.okTexto}>Atualizar situação</Text>
          </Pressable>
        </View>
        <Text style={s.sub}>Lojas e motoristas cadastram a conta no app e fazem a prova de vida da Pagar.me. Enquanto não estiver ativa, o valor fica com a MOVI e vai para o saldo (repasse manual).</Text>
        <View style={[s.colunas, !largo && { flexDirection: 'column' }]}>
          {lista('Lojas', d.lojas)}
          {lista('Motoristas', d.motoristas)}
        </View>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  conteudo: { padding: 16, gap: 14, paddingBottom: 40 },
  erro: { color: cores.erro, fontSize: 14 },
  cartao: { backgroundColor: cores.cartao, borderRadius: raio + 2, padding: 16, gap: 12, borderWidth: 1, borderColor: cores.borda },
  titulo: { fontSize: 18, fontWeight: '700', color: cores.texto },
  sub: { fontSize: 13, color: cores.suave, lineHeight: 19 },
  item: { fontSize: 15, fontWeight: '700', color: cores.texto },
  abas: { flexDirection: 'row', gap: 8 },
  aba: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: cores.borda, backgroundColor: cores.fundo },
  abaAtiva: { backgroundColor: cores.primaria, borderColor: cores.primaria },
  abaTexto: { color: cores.texto, fontWeight: '700' },
  chave: { borderWidth: 1, borderRadius: raio, padding: 12, gap: 4 },
  campos: { flexDirection: 'row', gap: 12, alignItems: 'flex-end' },
  campo: { flex: 1, gap: 4 },
  rotulo: { fontSize: 13, color: cores.suave },
  input: { backgroundColor: cores.fundo, borderRadius: 10, borderWidth: 1, borderColor: cores.borda, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: cores.texto },
  ok: { backgroundColor: cores.primaria, borderRadius: 10, paddingVertical: 11, paddingHorizontal: 18, alignItems: 'center' },
  okTexto: { color: '#fff', fontWeight: '700' },
  codigo: { fontFamily: 'monospace', fontSize: 13, color: cores.texto, backgroundColor: cores.fundo, borderRadius: 8, padding: 10 },
  secao: { fontSize: 13, fontWeight: '800', color: cores.suave, letterSpacing: 1, textTransform: 'uppercase', marginTop: 4 },
  linhaConta: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  etiqueta: { fontSize: 12, fontWeight: '800' },
  colunas: { flexDirection: 'row', gap: 16, alignItems: 'flex-start' },
});
