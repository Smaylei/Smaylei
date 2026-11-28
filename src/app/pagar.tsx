import * as Clipboard from 'expo-clipboard';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import Autenticacao3DS, { type Resultado3DS } from '../components/Autenticacao3DS';
import { cores, raio } from '../components/tema';
import { useApp, usePreco } from '../estado/AppContext';
import { API, api, ErroApi, type CorridaCliente, type Gorjeta } from '../services/api';
import * as D from '../services/delivery';
import * as P from '../services/pagamento';
import { formatarReais } from '../services/preco';
import { SOLICITANTE } from '../variante';

type Resumo = { titulo: string; valor: number; pendente: boolean; prazo: string | null; servico?: number };

async function resumo(tipo: P.TipoPagamento, id: string): Promise<Resumo> {
  if (tipo === 'corrida') {
    const c = await api<CorridaCliente>(SOLICITANTE, `/v2/corridas/${id}`);
    const pendente = c.status === 'pagamento_pendente' || !!c.aguardandoPagamento;
    return {
      titulo: c.pacote ? `${c.servicoTitulo} · ${c.pacote.viagens} viagens` : (c.servicoTitulo ?? 'Frete'), valor: c.pacote?.valor ?? c.valor, pendente, prazo: c.pagamentoAte ?? null,
      servico: (c.pacote ? c.pacote.taxaServico : c.taxaServico) ?? 0,
    };
  }
  if (tipo === 'pedido') {
    const p = await D.pedido(id);
    return { titulo: `Pedido #${p.codigo} · ${p.loja.nome}`, valor: p.total, pendente: p.status === 'pagamento_pendente', prazo: p.pagamentoAte, servico: p.taxaServico ?? 0 };
  }
  if (tipo === 'mensalidade') {
    const m = await D.mensalidade(id);
    return { titulo: 'Vitrine MOVI Delivery · 30 dias', valor: m.valor, pendente: m.status === 'pendente', prazo: null };
  }
  const g = await api<Gorjeta>(SOLICITANTE, `/v2/gorjetas/${id}`);
  return { titulo: 'Gorjeta para o motorista', valor: g.valor, pendente: g.status === 'pendente', prazo: null };
}

const ABAS: Record<P.MetodoPagamento, string> = { pix: '⚡ Pix', cartao: '💳 Crédito', debito: '🏦 Débito' };
const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

/** Pagamento dentro do app (Pagar.me): Pix, crédito à vista (com cartão salvo) ou débito com a confirmação do banco. */
export default function Pagar() {
  const { tipo, id } = useLocalSearchParams<{ tipo: P.TipoPagamento; id: string }>();
  const { config } = useApp();
  const preco = usePreco();
  const [r, setR] = useState<Resumo | null>(null);
  const [metodo, setMetodo] = useState<P.MetodoPagamento>('pix');
  const [cob, setCob] = useState<P.Cobranca | null>(null);
  const [cartao, setCartao] = useState({ numero: '', nome: '', validade: '', cvv: '', cep: '', email: '' });
  const [salvos, setSalvos] = useState<P.CartaoSalvo[]>([]);
  const [escolhido, setEscolhido] = useState<string>('novo'); // id do cartão salvo ou 'novo'
  const [salvar, setSalvar] = useState(true);
  const [tds, setTds] = useState<{ token: string; ambiente: 'teste' | 'producao'; pedido: object; email: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const saiu = useRef(false);
  const comDebito = config.debitoAtivo && Platform.OS !== 'web';

  const concluir = useCallback(() => {
    if (saiu.current) return;
    saiu.current = true;
    if (tipo === 'corrida') router.replace(`/corrida/${id}`);
    else if (tipo === 'pedido') router.replace(`/meu-pedido/${id}`);
    else if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [tipo, id]);

  useEffect(() => {
    resumo(tipo, id)
      .then((x) => {
        setR(x);
        if (!x.pendente) concluir();
      })
      .catch((e) => setMsg((e as Error).message));
    // Cartões salvos (compra com um clique): o primeiro já vem escolhido.
    P.cartoesSalvos()
      .then((l) => {
        setSalvos(l);
        if (l.length) setEscolhido(l[0].id);
      })
      .catch(() => {});
  }, [tipo, id, concluir]);

  // Pix gerado: confere a cada 4 s até a Pagar.me confirmar.
  useEffect(() => {
    if (!cob || cob.status !== 'pendente' || cob.metodo !== 'pix') return;
    const t = setInterval(() => {
      P.cobranca(cob.id)
        .then((c) => {
          setCob(c);
          if (c.status === 'paga') concluir();
        })
        .catch(() => {});
    }, 4000);
    return () => clearInterval(t);
  }, [cob, concluir]);

  function resultadoCartao(c: P.Cobranca) {
    setCob(c);
    if (c.status === 'paga') concluir();
    else setMsg(c.erro ?? 'Pagamento não aprovado. Tente outro cartão ou o Pix.');
  }
  async function gerarPix() {
    setOcupado(true);
    setMsg(null);
    try {
      const c = await P.pagar(tipo, id, 'pix');
      setCob(c);
      if (c.status === 'paga') concluir();
    } catch (e) {
      setMsg(e instanceof ErroApi ? e.message : 'Não foi possível gerar o Pix.');
    } finally {
      setOcupado(false);
    }
  }
  /** Confere o formulário do cartão; devolve mês e ano ou null (com a mensagem). */
  function conferirCartao() {
    const [mes, ano] = cartao.validade.split('/').map((x) => x.trim());
    if (cartao.numero.replace(/\D/g, '').length < 13 || !mes || !ano || cartao.cvv.length < 3 || cartao.nome.trim().length < 3 || cartao.cep.replace(/\D/g, '').length !== 8) {
      setMsg('Confira os dados do cartão e o CEP.');
      return null;
    }
    if (!config.pagarmeChavePublica) {
      setMsg('Pagamento com cartão indisponível agora. Use o Pix.');
      return null;
    }
    return { mes, ano };
  }
  const token = (v: { mes: string; ano: string }) => P.tokenizarCartao(config.pagarmeChavePublica, { numero: cartao.numero, nome: cartao.nome, mes: v.mes, ano: v.ano, cvv: cartao.cvv });

  async function pagarCredito() {
    setMsg(null);
    if (escolhido !== 'novo') {
      setOcupado(true);
      try {
        resultadoCartao(await P.pagar(tipo, id, 'cartao', { cartaoId: escolhido }));
      } catch (e) {
        setMsg((e as Error).message);
      } finally {
        setOcupado(false);
      }
      return;
    }
    const v = conferirCartao();
    if (!v) return;
    setOcupado(true);
    try {
      resultadoCartao(await P.pagar(tipo, id, 'cartao', { cardToken: await token(v), cep: cartao.cep, salvar }));
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  // Débito: 1) o banco confirma (3DS) 2) token do cartão 3) pagamento com a confirmação.
  async function pagarDebito() {
    setMsg(null);
    const v = conferirCartao();
    if (!v || !r) return;
    setOcupado(true);
    try {
      const ini = await P.iniciar3ds();
      const email = cartao.email.trim() || ini.cliente.email || '';
      if (!emailOk(email)) {
        setMsg('Informe o seu e-mail: o banco usa para confirmar o débito.');
        setOcupado(false);
        return;
      }
      const ano = v.ano.length === 2 ? 2000 + Number(v.ano) : Number(v.ano);
      const pedido = {
        customer: {
          name: ini.cliente.nome, email, code: ini.cliente.codigo, ...(ini.cliente.documento ? { document: ini.cliente.documento } : {}),
          ...(ini.cliente.telefone ? { phones: { mobile_phone: { country_code: '55', area_code: ini.cliente.ddd, number: ini.cliente.telefone } } } : {}),
        },
        payments: [
          {
            payment_method: 'debit_card',
            amount: Math.round(conta.total * 100),
            debit_card: {
              card: {
                number: cartao.numero.replace(/\D/g, ''), holder_name: cartao.nome.trim().toUpperCase(), exp_month: Number(v.mes), exp_year: ano,
                billing_address: { country: 'BR', state: ini.uf, city: ini.cidade, zip_code: cartao.cep.replace(/\D/g, ''), line_1: ini.endereco },
              },
            },
          },
        ],
        requestor_url: API,
      };
      setTds({ token: ini.token, ambiente: ini.ambiente, pedido, email });
    } catch (e) {
      setMsg((e as Error).message);
      setOcupado(false);
    }
  }
  async function debitoConfirmado(res: Resultado3DS) {
    const email = tds?.email;
    setTds(null);
    const v = conferirCartao();
    if (!v) return setOcupado(false);
    try {
      resultadoCartao(await P.pagar(tipo, id, 'debito', { cardToken: await token(v), cep: cartao.cep, tdsTransacao: res.transacao, email }));
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }
  function remover(c: P.CartaoSalvo) {
    Alert.alert('Remover cartão?', `${c.bandeira} •••• ${c.final} deixa de ficar salvo.`, [
      { text: 'Voltar', style: 'cancel' },
      {
        text: 'Remover',
        style: 'destructive',
        onPress: () =>
          P.removerCartao(c.id)
            .then(() => {
              const resto = salvos.filter((x) => x.id !== c.id);
              setSalvos(resto);
              setEscolhido(resto[0]?.id ?? 'novo');
            })
            .catch((e) => Alert.alert('Cartão', (e as Error).message)),
      },
    ]);
  }
  async function copiar() {
    if (!cob?.qrCode) return;
    await Clipboard.setStringAsync(cob.qrCode);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2500);
  }

  if (!r) return msg ? <Text style={[s.erro, { padding: 20 }]}>{msg}</Text> : <ActivityIndicator style={{ marginTop: 60 }} color={cores.primaria} />;
  const pixPronto = cob?.metodo === 'pix' && cob.status === 'pendente';
  // Preço ao cliente: um só, igual em qualquer meio (a taxa do pagamento já vem embutida, sem aparecer).
  const conta = { total: cob?.status === 'pendente' ? cob.valor : tipo === 'gorjeta' || tipo === 'mensalidade' ? r.valor : preco(r.valor, r.servico ?? 0) };
  const abas: P.MetodoPagamento[] = comDebito ? ['pix', 'cartao', 'debito'] : ['pix', 'cartao'];
  const novoCartao = metodo === 'debito' || escolhido === 'novo';

  const formulario = (
    <>
      <Text style={s.rotulo}>Número do cartão</Text>
      <TextInput style={s.input} value={cartao.numero} onChangeText={(t) => setCartao({ ...cartao, numero: t })} keyboardType="number-pad" placeholder="0000 0000 0000 0000" placeholderTextColor={cores.apagado} maxLength={23} autoComplete="cc-number" />
      <Text style={s.rotulo}>Nome impresso no cartão</Text>
      <TextInput style={s.input} value={cartao.nome} onChangeText={(t) => setCartao({ ...cartao, nome: t })} autoCapitalize="characters" placeholder="NOME SOBRENOME" placeholderTextColor={cores.apagado} maxLength={64} autoComplete="cc-name" />
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={s.rotulo}>Validade</Text>
          <TextInput style={s.input} value={cartao.validade} onChangeText={(t) => setCartao({ ...cartao, validade: t })} placeholder="MM/AA" placeholderTextColor={cores.apagado} maxLength={7} keyboardType="numbers-and-punctuation" autoComplete="cc-exp" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.rotulo}>CVV</Text>
          <TextInput style={s.input} value={cartao.cvv} onChangeText={(t) => setCartao({ ...cartao, cvv: t })} keyboardType="number-pad" placeholder="123" placeholderTextColor={cores.apagado} maxLength={4} secureTextEntry autoComplete="cc-csc" />
        </View>
      </View>
      <Text style={s.rotulo}>CEP de cobrança</Text>
      <TextInput style={s.input} value={cartao.cep} onChangeText={(t) => setCartao({ ...cartao, cep: t })} keyboardType="number-pad" placeholder="89270-000" placeholderTextColor={cores.apagado} maxLength={9} autoComplete="postal-code" />
    </>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.conteudo} keyboardShouldPersistTaps="handled">
        <Stack.Screen options={{ title: 'Pagamento' }} />
        <View style={s.topo}>
          <Text style={s.titulo}>{r.titulo}</Text>
          <Text style={s.valor}>{formatarReais(conta.total)}</Text>
          {r.prazo && <Text style={s.prazo}>Pague até {new Date(r.prazo).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</Text>}
        </View>

        <View style={s.abas}>
          {abas.map((m) => (
            <Pressable
              key={m}
              style={[s.aba, metodo === m && s.abaAtiva]}
              onPress={() => {
                setMetodo(m);
                setMsg(null);
              }}
            >
              <Text style={[s.abaTexto, metodo === m && { color: '#fff' }]}>{ABAS[m]}</Text>
            </Pressable>
          ))}
        </View>

        {metodo === 'pix' &&
          (pixPronto ? (
            <View style={s.cartao}>
              {cob.qrCodeUrl && <Image source={{ uri: cob.qrCodeUrl }} style={s.qr} resizeMode="contain" />}
              <Text style={s.texto}>Abra o app do seu banco, escolha Pix → Ler QR Code, ou copie o código abaixo (Pix copia e cola).</Text>
              <Pressable style={s.botao} onPress={copiar}>
                <Text style={s.botaoTexto}>{copiado ? '✓ Código copiado' : 'Copiar código Pix'}</Text>
              </Pressable>
              <View style={s.aguardando}>
                <ActivityIndicator color={cores.primaria} />
                <Text style={s.suave}>Aguardando o pagamento… a confirmação é automática.</Text>
              </View>
            </View>
          ) : (
            <Pressable style={[s.botao, ocupado && { opacity: 0.5 }]} disabled={ocupado} onPress={gerarPix}>
              {ocupado ? <ActivityIndicator color="#fff" /> : <Text style={s.botaoTexto}>Gerar Pix de {formatarReais(conta.total)}</Text>}
            </Pressable>
          ))}

        {metodo === 'cartao' && (
          <View style={s.cartao}>
            {salvos.length > 0 && (
              <>
                <Text style={s.rotulo}>Cartões salvos</Text>
                {salvos.map((c) => (
                  <Pressable key={c.id} style={[s.salvo, escolhido === c.id && s.salvoAtivo]} onPress={() => setEscolhido(c.id)}>
                    <View style={[s.radio, escolhido === c.id && s.radioAtivo]} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.salvoTexto}>
                        {c.bandeira} •••• {c.final}
                      </Text>
                      {!!c.mes && !!c.ano && (
                        <Text style={s.suave}>
                          Validade {String(c.mes).padStart(2, '0')}/{String(c.ano).slice(-2)}
                        </Text>
                      )}
                    </View>
                    <Pressable onPress={() => remover(c)} hitSlop={8}>
                      <Text style={s.remover}>Remover</Text>
                    </Pressable>
                  </Pressable>
                ))}
                <Pressable style={[s.salvo, escolhido === 'novo' && s.salvoAtivo]} onPress={() => setEscolhido('novo')}>
                  <View style={[s.radio, escolhido === 'novo' && s.radioAtivo]} />
                  <Text style={[s.salvoTexto, { flex: 1 }]}>Usar outro cartão</Text>
                </Pressable>
              </>
            )}
            {novoCartao && (
              <>
                {formulario}
                <View style={s.linhaSalvar}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.salvoTexto}>Salvar este cartão</Text>
                    <Text style={s.suave}>Nas próximas compras é só tocar em pagar.</Text>
                  </View>
                  <Switch value={salvar} onValueChange={setSalvar} trackColor={{ true: cores.primaria }} />
                </View>
              </>
            )}
            <Pressable style={[s.botao, ocupado && { opacity: 0.5 }]} disabled={ocupado} onPress={pagarCredito}>
              {ocupado ? <ActivityIndicator color="#fff" /> : <Text style={s.botaoTexto}>Pagar {formatarReais(conta.total)} no crédito</Text>}
            </Pressable>
            <Text style={s.suave}>
              {novoCartao
                ? 'Os dados do cartão vão direto para a Pagar.me; a MOVI não guarda o número do seu cartão. À vista, sem parcelamento.'
                : 'Cartão guardado com segurança na Pagar.me; no app ficam só a bandeira e o final. À vista, sem parcelamento.'}
            </Text>
          </View>
        )}

        {metodo === 'debito' && (
          <View style={s.cartao}>
            {formulario}
            <Text style={s.rotulo}>E-mail (o banco usa para confirmar)</Text>
            <TextInput style={s.input} value={cartao.email} onChangeText={(t) => setCartao({ ...cartao, email: t })} keyboardType="email-address" autoCapitalize="none" placeholder="voce@email.com" placeholderTextColor={cores.apagado} maxLength={77} autoComplete="email" />
            <Pressable style={[s.botao, ocupado && { opacity: 0.5 }]} disabled={ocupado} onPress={pagarDebito}>
              {ocupado ? <ActivityIndicator color="#fff" /> : <Text style={s.botaoTexto}>Pagar {formatarReais(conta.total)} no débito</Text>}
            </Pressable>
            <Text style={s.suave}>Visa ou Mastercard. O seu banco pode pedir uma confirmação (app do banco, SMS ou senha) antes de aprovar.</Text>
          </View>
        )}

        {msg && <Text style={s.erro}>{msg}</Text>}
        <Text style={s.info}>
          🔒 Pagamento processado pela Pagar.me (Stone).{' '}
          {tipo === 'pedido' ? 'Se a loja não aceitar, o valor volta automaticamente.' : tipo === 'corrida' ? 'Se a corrida for cancelada antes da chegada, o valor volta automaticamente.' : ''}
        </Text>
      </ScrollView>
      {tds && (
        <Autenticacao3DS
          visivel
          token={tds.token}
          ambiente={tds.ambiente}
          pedido={tds.pedido}
          aoConcluir={debitoConfirmado}
          aoFalhar={(m) => {
            setTds(null);
            setOcupado(false);
            setMsg(m);
          }}
          aoCancelar={() => {
            setTds(null);
            setOcupado(false);
          }}
        />
      )}
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  conteudo: { padding: 20, gap: 14, paddingBottom: 40 },
  topo: { backgroundColor: cores.primariaClara, borderRadius: raio, padding: 18, gap: 4, alignItems: 'center' },
  titulo: { fontSize: 15, color: cores.texto, fontWeight: '600', textAlign: 'center' },
  valor: { fontSize: 32, fontWeight: '800', color: cores.texto },
  prazo: { fontSize: 13, color: cores.alerta, fontWeight: '700' },
  salvo: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: cores.borda, borderRadius: 12, padding: 12, backgroundColor: cores.fundo },
  salvoAtivo: { borderColor: cores.primaria },
  salvoTexto: { fontSize: 15, fontWeight: '700', color: cores.texto },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: cores.borda },
  radioAtivo: { borderColor: cores.primaria, backgroundColor: cores.primaria },
  remover: { color: cores.erro, fontWeight: '700', fontSize: 13 },
  linhaSalvar: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
  abas: { flexDirection: 'row', gap: 8 },
  aba: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: cores.borda, backgroundColor: cores.cartao },
  abaAtiva: { backgroundColor: cores.primaria, borderColor: cores.primaria },
  abaTexto: { color: cores.texto, fontWeight: '700' },
  cartao: { backgroundColor: cores.cartao, borderRadius: raio + 2, padding: 16, gap: 10, borderWidth: 1, borderColor: cores.borda },
  qr: { width: 220, height: 220, alignSelf: 'center', backgroundColor: '#fff', borderRadius: 12 },
  texto: { fontSize: 14, color: cores.texto, lineHeight: 20, textAlign: 'center' },
  suave: { fontSize: 12, color: cores.suave, lineHeight: 18 },
  aguardando: { flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'center' },
  rotulo: { fontSize: 13, color: cores.suave },
  input: { backgroundColor: cores.fundo, borderRadius: 12, borderWidth: 1, borderColor: cores.borda, paddingHorizontal: 12, paddingVertical: 12, fontSize: 16, color: cores.texto },
  botao: { backgroundColor: cores.primaria, borderRadius: raio, paddingVertical: 16, alignItems: 'center' },
  botaoTexto: { color: '#fff', fontSize: 16, fontWeight: '700' },
  erro: { color: cores.erro, fontSize: 14 },
  info: { fontSize: 12, color: cores.suave, lineHeight: 18 },
});
