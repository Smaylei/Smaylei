import { router, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { cores, raio } from '../components/tema';
import { VEICULOS, type Veiculo } from '../data/servicos';
import { useApp, usePreco } from '../estado/AppContext';
import { irParaPagamento } from '../services/pagamento';
import { alterarItem, esvaziar, subtotal, useCarrinho } from '../estado/carrinho';
import { ErroApi } from '../services/api';
import * as D from '../services/delivery';
import { formatarReais } from '../services/preco';

/** Carrinho do delivery: itens, entrega em casa, frete calculado pelo servidor e pagamento único. */
export default function CarrinhoTela() {
  const carrinho = useCarrinho();
  const { casa, config } = useApp();
  const preco = usePreco();
  const [veiculo, setVeiculo] = useState<Veiculo>('carro');
  const [moto, setMoto] = useState(false);
  const [minimo, setMinimo] = useState(0);
  const [preparo, setPreparo] = useState(20);
  const [cot, setCot] = useState<{ frete: number; minutos: number; entrega: D.Entrega } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [obs, setObs] = useState('');
  const [enviando, setEnviando] = useState(false);
  const lojaId = carrinho.lojaId;

  useEffect(() => {
    if (!lojaId) return;
    let vivo = true;
    D.vitrine(lojaId)
      .then((v) => {
        if (!vivo) return;
        setMoto(v.moto);
        setMinimo(v.loja.pedidoMinimo);
        setPreparo(v.loja.preparoMin);
      })
      .catch(() => {});
    D.cotarPedido(lojaId, veiculo)
      .then((c) => vivo && (setCot(c), setErro(null)))
      .catch((e) => vivo && (setCot(null), setErro((e as Error).message)));
    return () => {
      vivo = false;
    };
  }, [lojaId, veiculo]);

  if (!lojaId || !carrinho.itens.length)
    return (
      <View style={s.vazio}>
        <Stack.Screen options={{ title: 'Carrinho' }} />
        <Text style={{ fontSize: 34 }}>🛒</Text>
        <Text style={s.vazioTexto}>Seu carrinho está vazio.</Text>
        <Pressable style={s.botaoSec} onPress={() => router.replace('/delivery')}>
          <Text style={s.botaoSecTexto}>Ver lojas</Text>
        </Pressable>
      </View>
    );

  const sub = subtotal(carrinho);
  const faltaMinimo = minimo > 0 && sub < minimo;
  // Preço ao cliente: a taxa do pagamento vai embutida na entrega (sem aparecer como taxa).
  const total = cot ? preco(Math.round((sub + cot.frete) * 100) / 100) : null;
  const pode = !!cot && cot.entrega.ok && !faltaMinimo && !enviando;

  async function pagar() {
    if (!lojaId || !pode) return;
    setEnviando(true);
    setErro(null);
    try {
      const p = await D.fazerPedido({ lojaId, itens: carrinho.itens.map((i) => ({ produtoId: i.produto.id, qtd: i.qtd })), observacao: obs, veiculo });
      esvaziar();
      irParaPagamento(config.gateway, 'pedido', p.id, { substituir: true });
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Não foi possível fazer o pedido.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: 'Carrinho' }} />
      <ScrollView contentContainerStyle={s.conteudo} keyboardShouldPersistTaps="handled">
        <Text style={s.loja}>{carrinho.lojaNome}</Text>
        {carrinho.itens.map(({ produto, qtd }) => (
          <View key={produto.id} style={s.item}>
            <View style={{ flex: 1 }}>
              <Text style={s.itemNome}>{produto.nome}</Text>
              <Text style={s.itemPreco}>{formatarReais(produto.preco * qtd)}</Text>
            </View>
            <View style={s.passo}>
              <Pressable style={s.passoBotao} onPress={() => alterarItem({ id: lojaId, nome: carrinho.lojaNome }, produto, -1)} hitSlop={6}>
                <Text style={s.passoTexto}>−</Text>
              </Pressable>
              <Text style={s.qtd}>{qtd}</Text>
              <Pressable style={s.passoBotao} onPress={() => alterarItem({ id: lojaId, nome: carrinho.lojaNome }, produto, 1)} hitSlop={6}>
                <Text style={s.passoTexto}>+</Text>
              </Pressable>
            </View>
          </View>
        ))}
        <Pressable onPress={() => router.push(`/loja/${lojaId}`)}>
          <Text style={s.link}>+ Adicionar mais itens</Text>
        </Pressable>

        <Text style={s.rotulo}>Observação para a loja (opcional)</Text>
        <TextInput
          style={s.input}
          value={obs}
          onChangeText={setObs}
          placeholder="Ex.: sem cebola, troco não precisa…"
          placeholderTextColor={cores.apagado}
          maxLength={300}
          multiline
        />

        <Text style={s.rotulo}>Entregar em</Text>
        <View style={s.cartao}>
          <Text style={s.texto}>🏠 {casa?.endereco ?? '—'}</Text>
          <Pressable onPress={() => router.push('/cadastro')} hitSlop={8}>
            <Text style={s.link}>Alterar</Text>
          </Pressable>
        </View>

        {moto && (
          <>
            <Text style={s.rotulo}>Entrega de</Text>
            <View style={s.segmento}>
              {VEICULOS.map((v) => (
                <Pressable key={v.id} style={[s.seg, veiculo === v.id && s.segAtivo]} onPress={() => setVeiculo(v.id)}>
                  <Text style={[s.segTexto, veiculo === v.id && { color: '#fff' }]}>
                    {v.icone} {v.nome}
                  </Text>
                </Pressable>
              ))}
            </View>
            {veiculo === 'moto' && <Text style={s.dica}>🏍️ Moto: ideal para pedidos pequenos (até 2 sacolas ou uma caixa pequena).</Text>}
          </>
        )}

        <View style={s.resumo}>
          <Linha a="Produtos" b={formatarReais(sub)} />
          <Linha a="Entrega MOVI" b={total != null ? formatarReais(Math.round((total - sub) * 100) / 100) : '…'} />
          <View style={s.divisor} />
          <Linha a="Total" b={total != null ? formatarReais(total) : '…'} forte />
          {cot && <Text style={s.dica}>Chega em ~{preparo + cot.minutos} min (preparo da loja + entrega).</Text>}
        </View>
        {faltaMinimo && <Text style={s.erro}>O pedido mínimo desta loja é {formatarReais(minimo)}.</Text>}
        {cot && !cot.entrega.ok && <Text style={s.erro}>Entrega indisponível agora: {cot.entrega.motivo}</Text>}
        {erro && <Text style={s.erro}>{erro}</Text>}
        <Text style={s.info}>
          🔒 Você paga tudo de uma vez no app (Pix ou cartão à vista). O valor fica retido: se a loja não aceitar, o pedido é cancelado e o valor devolvido.
        </Text>
      </ScrollView>
      <View style={s.rodape}>
        <Pressable style={[s.botao, !pode && { opacity: 0.45 }]} disabled={!pode} onPress={pagar}>
          {enviando ? <ActivityIndicator color="#fff" /> : <Text style={s.botaoTexto}>{total != null ? `Pagar ${formatarReais(total)}` : 'Calculando…'}</Text>}
        </Pressable>
      </View>
    </View>
  );
}

function Linha({ a, b, forte }: { a: string; b: string; forte?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={[s.texto, forte && { fontWeight: '800', fontSize: 17 }]}>{a}</Text>
      <Text style={[s.texto, forte && { fontWeight: '800', fontSize: 17 }]}>{b}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  conteudo: { padding: 20, gap: 10, paddingBottom: 120 },
  vazio: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 30 },
  vazioTexto: { color: cores.suave, fontSize: 15 },
  loja: { fontSize: 20, fontWeight: '700', color: cores.texto, marginBottom: 4 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: cores.cartao, borderRadius: raio, padding: 12, borderWidth: 1, borderColor: cores.borda },
  itemNome: { fontSize: 15, fontWeight: '700', color: cores.texto },
  itemPreco: { fontSize: 14, color: cores.suave, marginTop: 2 },
  passo: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: cores.primariaClara, borderRadius: 12, paddingHorizontal: 6, paddingVertical: 4 },
  passoBotao: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  passoTexto: { color: cores.primaria, fontSize: 22, fontWeight: '700', lineHeight: 24 },
  qtd: { color: cores.texto, fontSize: 16, fontWeight: '700', minWidth: 18, textAlign: 'center' },
  link: { color: cores.primaria, fontWeight: '700', fontSize: 14, paddingVertical: 4 },
  rotulo: { fontSize: 13, color: cores.suave, marginTop: 8 },
  input: { backgroundColor: cores.cartao, borderRadius: 12, borderWidth: 1, borderColor: cores.borda, padding: 12, fontSize: 15, color: cores.texto, minHeight: 60, textAlignVertical: 'top' },
  cartao: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: cores.cartao, borderRadius: raio, padding: 14, borderWidth: 1, borderColor: cores.borda },
  texto: { fontSize: 15, color: cores.texto, flexShrink: 1 },
  segmento: { flexDirection: 'row', gap: 8 },
  seg: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: cores.borda, backgroundColor: cores.cartao },
  segAtivo: { backgroundColor: cores.primaria, borderColor: cores.primaria },
  segTexto: { color: cores.texto, fontWeight: '700' },
  dica: { fontSize: 12, color: cores.suave, lineHeight: 18 },
  resumo: { backgroundColor: cores.cartao, borderRadius: raio, padding: 16, gap: 8, marginTop: 10, borderWidth: 1, borderColor: cores.borda },
  divisor: { height: 1, backgroundColor: cores.borda },
  erro: { color: cores.erro, fontSize: 14 },
  info: { fontSize: 12, color: cores.suave, lineHeight: 18, marginTop: 4 },
  rodape: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16, backgroundColor: cores.fundo, borderTopWidth: 1, borderTopColor: cores.borda },
  botao: { backgroundColor: cores.primaria, borderRadius: raio, paddingVertical: 16, alignItems: 'center' },
  botaoTexto: { color: '#fff', fontSize: 17, fontWeight: '700' },
  botaoSec: { borderRadius: raio, paddingVertical: 12, paddingHorizontal: 24, borderWidth: 1.5, borderColor: cores.primaria },
  botaoSecTexto: { color: cores.primaria, fontWeight: '700' },
});
