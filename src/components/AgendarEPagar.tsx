import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Mercado } from '../data/mercados';
import {
  criarLinkPagamento,
  ErroPagamento,
  lerRetorno,
  novoOrderNsu,
  verificarPagamento,
} from '../services/pagamento';
import { salvarPedido, type Pedido } from '../services/pedidos';
import { descreverUrgencia, formatarReais, precoFrete, type Urgencia } from '../services/preco';
import { cores, raio } from './tema';

const FAIXAS = [
  { inicio: 8, rotulo: '08h–10h' },
  { inicio: 10, rotulo: '10h–12h' },
  { inicio: 13, rotulo: '13h–15h' },
  { inicio: 15, rotulo: '15h–17h' },
  { inicio: 17, rotulo: '17h–19h' },
];
const ANTECEDENCIA_MIN = 60; // agendar com pelo menos 1 hora de antecedência
const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

type Dia = { data: Date; rotulo: string; faixas: typeof FAIXAS };

function proximosDias(): Dia[] {
  const agora = new Date();
  const dias: Dia[] = [];
  for (let i = 0; dias.length < 6 && i < 8; i++) {
    const d = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + i);
    const faixas = FAIXAS.filter((f) => {
      const ini = new Date(d.getFullYear(), d.getMonth(), d.getDate(), f.inicio);
      return ini.getTime() - agora.getTime() >= ANTECEDENCIA_MIN * 60000;
    });
    if (!faixas.length) continue;
    const dd = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
    const rotulo = i === 0 ? `Hoje ${dd}` : i === 1 ? `Amanhã ${dd}` : `${SEMANA[d.getDay()]} ${dd}`;
    dias.push({ data: d, rotulo, faixas });
  }
  return dias;
}

type Props = {
  mercado: Mercado;
  sugerido: number;
  urgencia: Urgencia;
  nomeCliente: string;
  enderecoCliente: string;
};

type Estado =
  | { fase: 'escolha' }
  | { fase: 'gerando' }
  | { fase: 'aguardando'; pedido: Pedido }
  | { fase: 'pago'; pedido: Pedido }
  | { fase: 'erro'; mensagem: string };

export default function AgendarEPagar({ mercado, sugerido, urgencia, nomeCliente, enderecoCliente }: Props) {
  const [dias] = useState(proximosDias);
  const [agendado, setAgendado] = useState(true);
  const [diaIdx, setDiaIdx] = useState(0);
  const [faixa, setFaixa] = useState<string | null>(null);
  const [estado, setEstado] = useState<Estado>({ fase: 'escolha' });

  const valor = precoFrete(sugerido, agendado, urgencia);
  const dia = dias[diaIdx];
  const janela = agendado && dia && faixa ? `${dia.rotulo} · ${faixa}` : undefined;
  const podePagar = !agendado || !!janela;

  async function pagar() {
    setEstado({ fase: 'gerando' });
    const orderNsu = novoOrderNsu();
    const redirectUrl = Linking.createURL('pagamento');
    const descricao = `Frete ${mercado.nome} ida e volta - ${agendado ? `agendado ${janela}` : 'urgente'}`;
    const cliente = { name: nomeCliente !== 'Minha casa' ? nomeCliente : undefined };
    let checkoutUrl: string;
    try {
      try {
        checkoutUrl = await criarLinkPagamento({ orderNsu, valor, descricao, redirectUrl, cliente });
      } catch (e) {
        // Se a InfinitePay recusar o endereço de retorno do app, gera o link sem ele.
        if (e instanceof ErroPagamento && /ativado/.test(e.message)) throw e;
        checkoutUrl = await criarLinkPagamento({ orderNsu, valor, descricao, cliente });
      }
    } catch (e) {
      setEstado({ fase: 'erro', mensagem: (e as Error).message });
      return;
    }
    const pedido: Pedido = {
      orderNsu,
      mercadoId: mercado.id,
      mercadoNome: mercado.nome,
      valor,
      agendado,
      janela,
      criadoEm: new Date().toISOString(),
      checkoutUrl,
      status: 'aguardando',
    };
    await salvarPedido(pedido).catch(() => {});
    setEstado({ fase: 'aguardando', pedido });
    await abrirCheckout(pedido, redirectUrl);
  }

  async function abrirCheckout(pedido: Pedido, redirectUrl = Linking.createURL('pagamento')) {
    const r = await WebBrowser.openAuthSessionAsync(pedido.checkoutUrl, redirectUrl);
    if (r.type !== 'success') return;
    const ret = lerRetorno(r.url);
    if (!ret.slug || !ret.transactionNsu) return;
    try {
      const st = await verificarPagamento({
        orderNsu: ret.orderNsu ?? pedido.orderNsu,
        slug: ret.slug,
        transactionNsu: ret.transactionNsu,
      });
      if (st.pago) {
        const pago: Pedido = { ...pedido, status: 'pago', receiptUrl: ret.receiptUrl, metodo: st.metodo ?? ret.captureMethod };
        await salvarPedido(pago).catch(() => {});
        setEstado({ fase: 'pago', pedido: pago });
      }
    } catch {
      // segue aguardando; o comprovante também chega por e-mail
    }
  }

  if (estado.fase === 'pago') {
    const p = estado.pedido;
    return (
      <View style={[s.caixa, { backgroundColor: cores.primariaClara }]}>
        <Text style={s.okTitulo}>✓ Frete pago</Text>
        <Text style={s.texto}>
          {formatarReais(p.valor)} · {p.metodo === 'pix' ? 'Pix' : p.metodo === 'credit_card' ? 'Cartão' : 'Pago'} ·{' '}
          {p.agendado ? `Entrega agendada: ${p.janela}` : 'Entrega urgente'}
        </Text>
        {p.receiptUrl && (
          <Pressable onPress={() => WebBrowser.openBrowserAsync(p.receiptUrl!)} style={s.link}>
            <Text style={s.linkTexto}>Ver comprovante</Text>
          </Pressable>
        )}
      </View>
    );
  }

  return (
    <View style={s.caixa}>
      <Text style={s.rotulo}>Quando entregar?</Text>
      <View style={s.segmento}>
        <Opcao ativo={agendado} onPress={() => setAgendado(true)} titulo="Agendar" sub="preço normal" />
        <Opcao
          ativo={!agendado}
          onPress={() => setAgendado(false)}
          titulo="Agora (urgente)"
          sub={`${descreverUrgencia(urgencia)} no frete`}
        />
      </View>

      {agendado && (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
            {dias.map((d, i) => (
              <Chip
                key={d.rotulo}
                texto={d.rotulo}
                ativo={i === diaIdx}
                onPress={() => {
                  setDiaIdx(i);
                  setFaixa(null);
                }}
              />
            ))}
          </ScrollView>
          <View style={s.chipsQuebra}>
            {dia?.faixas.map((f) => (
              <Chip key={f.rotulo} texto={f.rotulo} ativo={faixa === f.rotulo} onPress={() => setFaixa(f.rotulo)} />
            ))}
          </View>
        </>
      )}

      <View style={s.totalLinha}>
        <Text style={s.texto}>{agendado ? (janela ? `Entrega ${janela}` : 'Escolha o dia e o horário') : 'Entrega o quanto antes'}</Text>
        <Text style={s.total}>{formatarReais(valor)}</Text>
      </View>
      {!agendado && (
        <Text style={s.detalhe}>
          {formatarReais(sugerido)} + urgência {descreverUrgencia(urgencia)}
        </Text>
      )}

      {estado.fase === 'aguardando' ? (
        <View style={{ marginTop: 12, gap: 6 }}>
          <Text style={s.texto}>Pagamento aberto. Assim que for aprovado, a confirmação aparece aqui.</Text>
          <Pressable style={s.botao} onPress={() => abrirCheckout(estado.pedido)}>
            <Text style={s.botaoTexto}>Continuar pagamento</Text>
          </Pressable>
          <Pressable onPress={() => setEstado({ fase: 'escolha' })} style={s.link}>
            <Text style={[s.linkTexto, { color: cores.suave }]}>Voltar</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable
          style={[s.botao, (!podePagar || estado.fase === 'gerando') && { opacity: 0.5 }]}
          disabled={!podePagar || estado.fase === 'gerando'}
          onPress={pagar}
        >
          {estado.fase === 'gerando' ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={s.botaoTexto}>Pagar frete {formatarReais(valor)}</Text>
          )}
        </Pressable>
      )}
      {estado.fase === 'erro' && <Text style={s.erro}>{estado.mensagem}</Text>}
      <Text style={s.detalhe}>
        Pix ou cartão pela InfinitePay. Para: {enderecoCliente}
      </Text>
    </View>
  );
}

function Opcao({ ativo, onPress, titulo, sub }: { ativo: boolean; onPress: () => void; titulo: string; sub: string }) {
  return (
    <Pressable onPress={onPress} style={[s.opcao, ativo && s.opcaoAtiva]} accessibilityRole="radio" accessibilityState={{ selected: ativo }}>
      <Text style={[s.opcaoTitulo, ativo && { color: cores.primaria }]}>{titulo}</Text>
      <Text style={s.detalhe}>{sub}</Text>
    </Pressable>
  );
}

function Chip({ texto, ativo, onPress }: { texto: string; ativo: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[s.chip, ativo && s.chipAtivo]} accessibilityRole="radio" accessibilityState={{ selected: ativo }}>
      <Text style={[s.chipTexto, ativo && { color: '#fff' }]}>{texto}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  caixa: { marginTop: 14, borderWidth: 1, borderColor: cores.borda, borderRadius: 12, padding: 14 },
  rotulo: { fontSize: 12, fontWeight: '700', color: cores.suave, textTransform: 'uppercase', letterSpacing: 0.5 },
  segmento: { flexDirection: 'row', gap: 8, marginTop: 8 },
  opcao: { flex: 1, borderWidth: 1, borderColor: cores.borda, borderRadius: 10, padding: 10 },
  opcaoAtiva: { borderColor: cores.primaria, borderWidth: 2, padding: 9, backgroundColor: cores.primariaClara },
  opcaoTitulo: { fontSize: 15, fontWeight: '700', color: cores.texto },
  chips: { gap: 8, paddingVertical: 10 },
  chipsQuebra: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: cores.borda, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 12, backgroundColor: cores.cartao },
  chipAtivo: { backgroundColor: cores.primaria, borderColor: cores.primaria },
  chipTexto: { fontSize: 13, fontWeight: '600', color: cores.texto },
  totalLinha: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, gap: 8 },
  total: { fontSize: 22, fontWeight: '800', color: cores.primaria, fontVariant: ['tabular-nums'] },
  texto: { fontSize: 14, color: cores.texto, flexShrink: 1 },
  detalhe: { fontSize: 12, color: cores.suave, marginTop: 4 },
  botao: { backgroundColor: cores.primaria, borderRadius: raio, paddingVertical: 15, alignItems: 'center', marginTop: 12 },
  botaoTexto: { color: '#fff', fontSize: 16, fontWeight: '700' },
  erro: { color: cores.erro, marginTop: 8, fontSize: 14 },
  link: { paddingVertical: 8 },
  linkTexto: { color: cores.primaria, fontWeight: '600' },
  okTitulo: { fontSize: 18, fontWeight: '800', color: cores.primaria },
});
