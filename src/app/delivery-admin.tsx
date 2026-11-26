import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { cores, raio } from '../components/tema';
import { categoriaLoja } from '../data/servicos';
import * as Admin from '../services/admin';
import { etapaPedido } from '../services/delivery';
import { formatarReais } from '../services/preco';

const data = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—');
const hora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const numero = (t: string) => Number(t.replace(',', '.'));

/** Delivery das lojas no Admin: liberar, mensalidade, repasses às lojas, vitrines e pedidos. */
export default function DeliveryAdmin() {
  const { width } = useWindowDimensions();
  const largo = width >= 900;
  const [d, setD] = useState<Admin.DeliveryAdmin | null>(null);
  const [cfg, setCfg] = useState<Admin.ConfigServidor | null>(null);
  const [form, setForm] = useState({ mensalidade: '', aceite: '' });
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const [x, r] = await Promise.all([Admin.delivery(), Admin.resumo()]);
      setD(x);
      setCfg(r.config);
      setForm({ mensalidade: String(r.config.deliveryMensalidade ?? 15).replace('.', ','), aceite: String(r.config.deliveryAceiteMin ?? 10) });
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

  if (!d || !cfg) return erro ? <Text style={[s.erro, { padding: 20 }]}>{erro}</Text> : <ActivityIndicator style={{ marginTop: 60 }} color={cores.primaria} />;

  async function salvar(c: Partial<Admin.ConfigServidor>) {
    try {
      setCfg(await Admin.salvarConfig(c));
      await carregar();
    } catch (e) {
      Alert.alert('Delivery', (e as Error).message);
    }
  }
  const liberar = (on: boolean) => salvar({ servicosAtivos: on ? [...cfg.servicosAtivos, 'delivery'] : cfg.servicosAtivos.filter((x) => x !== 'delivery') });
  function cortesia(l: Admin.LojaDeliveryAdmin) {
    Alert.alert(`Dar 30 dias de vitrine para ${l.nome}?`, 'Sem cobrança (cortesia). Os dias somam ao vencimento atual.', [
      { text: 'Voltar', style: 'cancel' },
      { text: 'Dar 30 dias', onPress: () => Admin.diasVitrine(l.id, 30).then(carregar).catch((e) => Alert.alert('Delivery', (e as Error).message)) },
    ]);
  }
  function repasse(r: Admin.RepasseLojaAdmin, acao: 'pagar' | 'recusar') {
    Alert.alert(
      acao === 'pagar' ? `Marcar como pago?` : 'Recusar o repasse?',
      acao === 'pagar' ? `Confirme que você fez o Pix de ${formatarReais(r.valor)} para ${r.loja_nome} na chave ${r.chave_pix}.` : 'O valor volta para o saldo da loja.',
      [
        { text: 'Voltar', style: 'cancel' },
        { text: acao === 'pagar' ? 'Já paguei' : 'Recusar', style: acao === 'pagar' ? 'default' : 'destructive', onPress: () => Admin.repasseLoja(r.id, acao).then(carregar).catch((e) => Alert.alert('Repasse', (e as Error).message)) },
      ],
    );
  }
  function cancelar(p: Admin.DeliveryAdmin['pedidos'][number]) {
    Alert.alert(`Cancelar o pedido #${p.codigo}?`, `O valor (${formatarReais(p.total)}) vai para Estornos, para você devolver ao cliente.`, [
      { text: 'Voltar', style: 'cancel' },
      { text: 'Cancelar pedido', style: 'destructive', onPress: () => Admin.cancelarPedido(p.id).then(carregar).catch((e) => Alert.alert('Pedido', (e as Error).message)) },
    ]);
  }

  const ativas = d.lojas.filter((l) => l.ativa).length;
  const abertos = d.pedidos.filter((p) => p.status === 'aguardando_loja' || p.status === 'aceito');
  const pendentes = d.repasses.filter((r) => r.status === 'solicitado');

  return (
    <ScrollView contentContainerStyle={s.conteudo} refreshControl={<RefreshControl refreshing={false} onRefresh={carregar} tintColor={cores.primaria} />}>
      <View style={s.cartao}>
        <View style={s.linha}>
          <View style={{ flex: 1 }}>
            <Text style={s.titulo}>Delivery das lojas</Text>
            <Text style={s.sub}>
              Lojistas publicam produtos e vendem pelo app. A loja paga só a mensalidade; o cliente paga produtos + frete pela MOVI, e os produtos são repassados 100% à loja depois
              da entrega.
            </Text>
          </View>
          <Text style={[s.estado, { color: d.liberado ? cores.sucesso : cores.apagado }]}>{d.liberado ? 'Liberado' : 'Desligado'}</Text>
          <Switch value={d.liberado} onValueChange={liberar} trackColor={{ true: cores.sucesso }} />
        </View>
        <View style={[s.campos, !largo && { flexDirection: 'column' }]}>
          <View style={s.campo}>
            <Text style={s.rotulo}>Mensalidade da vitrine (R$ / 30 dias)</Text>
            <TextInput style={s.input} value={form.mensalidade} onChangeText={(t) => setForm({ ...form, mensalidade: t })} keyboardType="decimal-pad" />
          </View>
          <View style={s.campo}>
            <Text style={s.rotulo}>Prazo para a loja aceitar (min)</Text>
            <TextInput style={s.input} value={form.aceite} onChangeText={(t) => setForm({ ...form, aceite: t })} keyboardType="number-pad" />
          </View>
          <Pressable style={s.ok} onPress={() => salvar({ deliveryMensalidade: numero(form.mensalidade), deliveryAceiteMin: Math.round(numero(form.aceite)) })}>
            <Text style={s.okTexto}>Salvar</Text>
          </Pressable>
        </View>
        <View style={s.linha}>
          <View style={{ flex: 1 }}>
            <Text style={s.item}>Cobrar urgência no frete do delivery</Text>
            <Text style={s.sub}>Desligado: o frete do delivery não leva o acréscimo de “pedido para agora” (Tarifas).</Text>
          </View>
          <Switch value={cfg.deliveryUrgencia} onValueChange={(v) => salvar({ deliveryUrgencia: v })} trackColor={{ true: cores.sucesso }} />
        </View>
      </View>

      <View style={s.numeros}>
        <Numero n={String(ativas)} t="vitrines ativas" />
        <Numero n={String(abertos.length)} t="pedidos em aberto" />
        <Numero n={formatarReais(pendentes.reduce((a, r) => a + r.valor, 0))} t={`${pendentes.length} repasse(s) a pagar`} alerta={pendentes.length > 0} />
        <Numero n={formatarReais(d.mensalidades.reduce((a, m) => a + m.valor, 0))} t="mensalidades recebidas" />
      </View>

      <View style={[s.colunas, !largo && { flexDirection: 'column' }]}>
        <View style={{ flex: 1, gap: 10 }}>
          <Text style={s.secao}>Repasses às lojas</Text>
          {!d.repasses.length && <Text style={s.sub}>Nenhum repasse pedido ainda.</Text>}
          {d.repasses.slice(0, 30).map((r) => (
            <View key={r.id} style={[s.bloco, r.status === 'solicitado' && s.blocoAlerta]}>
              <Text style={s.item}>
                {r.loja_nome} · {formatarReais(r.valor)}
              </Text>
              <Text style={s.sub}>
                Pix: {r.chave_pix} · pedido em {data(r.criado_em)} · {r.status === 'pago' ? `pago em ${data(r.pago_em)}` : r.status === 'recusado' ? 'recusado' : 'a pagar'}
              </Text>
              {r.status === 'solicitado' && (
                <View style={s.botoes}>
                  <Pressable style={s.ok} onPress={() => repasse(r, 'pagar')}>
                    <Text style={s.okTexto}>Marcar como pago</Text>
                  </Pressable>
                  <Pressable style={s.sec} onPress={() => repasse(r, 'recusar')}>
                    <Text style={s.secTexto}>Recusar</Text>
                  </Pressable>
                </View>
              )}
            </View>
          ))}

          <Text style={s.secao}>Vitrines</Text>
          {!d.lojas.length && <Text style={s.sub}>Nenhuma loja aprovada ainda.</Text>}
          {d.lojas.map((l) => (
            <View key={l.id} style={s.bloco}>
              <View style={s.linha}>
                <Text style={[s.item, { flex: 1 }]}>
                  {categoriaLoja(l.categoria).icone} {l.nome}
                </Text>
                <Text style={[s.etiqueta, { color: l.ativa ? cores.sucesso : cores.apagado }]}>{l.ativa ? (l.aberta ? 'ATIVA · ABERTA' : 'ATIVA · FECHADA') : 'SEM VITRINE'}</Text>
              </View>
              <Text style={s.sub}>
                {l.ativa ? `Paga até ${data(l.ativaAte)}` : l.ativaAte ? `Venceu em ${data(l.ativaAte)}` : 'Nunca ativou'} · {l.produtos}/{l.produtosTotal} produtos ativos · {l.pedidos} pedidos ·{' '}
                {formatarReais(l.saldo.disponivel)} a receber
              </Text>
              <Text style={s.sub}>
                {l.responsavel} · {l.telefone} · Pix {l.pix}
              </Text>
              <Pressable onPress={() => cortesia(l)}>
                <Text style={s.link}>+ 30 dias grátis</Text>
              </Pressable>
            </View>
          ))}
        </View>

        <View style={{ flex: 1, gap: 10 }}>
          <Text style={s.secao}>Pedidos recentes</Text>
          {!d.pedidos.length && <Text style={s.sub}>Nenhum pedido pago ainda.</Text>}
          {d.pedidos.slice(0, 60).map((p) => (
            <View key={p.id} style={[s.bloco, (p.status === 'aguardando_loja' || p.status === 'aceito') && { borderColor: cores.primaria }]}>
              <View style={s.linha}>
                <Text style={[s.item, { flex: 1 }]}>
                  #{p.codigo} · {p.loja.nome} → {p.cliente?.nome}
                </Text>
                <Text style={s.sub}>{hora(p.pagoEm ?? p.criadoEm)}</Text>
              </View>
              <Text style={[s.sub, { color: p.status === 'cancelado' ? cores.erro : p.status === 'entregue' ? cores.sucesso : cores.texto }]}>
                {etapaPedido(p)}
                {p.status === 'cancelado' && p.motivo ? ` · ${p.motivo}` : ''}
              </Text>
              <Text style={s.sub}>
                {p.itens.map((i) => `${i.qtd}× ${i.nome}`).join(', ')}
              </Text>
              <Text style={s.sub}>
                Produtos {formatarReais(p.subtotal)} + frete {formatarReais(p.frete)} = <Text style={{ color: cores.texto, fontWeight: '700' }}>{formatarReais(p.total)}</Text> ·{' '}
                {p.metodo === 'pix' ? 'Pix' : 'cartão'}
                {p.reembolso > 0 ? ` · estorno ${formatarReais(p.reembolso)}${p.reembolsadoEm ? ' feito' : ' pendente'}` : ''}
              </Text>
              {(p.status === 'aguardando_loja' || p.status === 'aceito') && (
                <Pressable onPress={() => cancelar(p)}>
                  <Text style={[s.link, { color: cores.erro }]}>Cancelar pedido</Text>
                </Pressable>
              )}
            </View>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

function Numero({ n, t, alerta }: { n: string; t: string; alerta?: boolean }) {
  return (
    <View style={[s.numero, alerta && s.blocoAlerta]}>
      <Text style={s.numeroN}>{n}</Text>
      <Text style={s.sub}>{t}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  conteudo: { padding: 16, gap: 14, paddingBottom: 40 },
  erro: { color: cores.erro, fontSize: 14 },
  cartao: { backgroundColor: cores.cartao, borderRadius: raio + 2, padding: 16, gap: 14, borderWidth: 1, borderColor: cores.borda },
  linha: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  titulo: { fontSize: 18, fontWeight: '700', color: cores.texto },
  estado: { fontSize: 13, fontWeight: '700' },
  sub: { fontSize: 13, color: cores.suave, lineHeight: 18 },
  item: { fontSize: 15, fontWeight: '700', color: cores.texto },
  campos: { flexDirection: 'row', gap: 12, alignItems: 'flex-end' },
  campo: { flex: 1, gap: 4 },
  rotulo: { fontSize: 13, color: cores.suave },
  input: { backgroundColor: cores.fundo, borderRadius: 10, borderWidth: 1, borderColor: cores.borda, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: cores.texto },
  ok: { backgroundColor: cores.primaria, borderRadius: 10, paddingVertical: 11, paddingHorizontal: 18, alignItems: 'center' },
  okTexto: { color: '#fff', fontWeight: '700' },
  sec: { borderRadius: 10, paddingVertical: 11, paddingHorizontal: 18, borderWidth: 1, borderColor: cores.erro },
  secTexto: { color: cores.erro, fontWeight: '700' },
  numeros: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  numero: { flexGrow: 1, flexBasis: 180, backgroundColor: cores.cartao, borderRadius: raio, padding: 14, borderWidth: 1, borderColor: cores.borda, gap: 2 },
  numeroN: { fontSize: 22, fontWeight: '800', color: cores.texto },
  colunas: { flexDirection: 'row', gap: 16, alignItems: 'flex-start' },
  secao: { fontSize: 13, fontWeight: '800', color: cores.suave, letterSpacing: 1, textTransform: 'uppercase', marginTop: 6 },
  bloco: { backgroundColor: cores.cartao, borderRadius: raio, padding: 14, gap: 4, borderWidth: 1, borderColor: cores.borda },
  blocoAlerta: { borderColor: cores.alerta, backgroundColor: cores.alertaFundo },
  etiqueta: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6 },
  botoes: { flexDirection: 'row', gap: 10, marginTop: 6 },
  link: { color: cores.primaria, fontWeight: '700', fontSize: 14, marginTop: 4 },
});
