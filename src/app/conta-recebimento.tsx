import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { cores, raio } from '../components/tema';
import { api, ErroApi } from '../services/api';
import { MODO } from '../variante';

type Estado = { disponivel: boolean; temConta: boolean; status: string | null; ativo: boolean; email: string | null };
const BANCOS = [
  ['001', 'Banco do Brasil'], ['104', 'Caixa'], ['237', 'Bradesco'], ['341', 'Itaú'], ['033', 'Santander'], ['260', 'Nubank'], ['077', 'Inter'],
  ['336', 'C6 Bank'], ['290', 'PagBank'], ['380', 'PicPay'], ['323', 'Mercado Pago'], ['756', 'Sicoob'], ['748', 'Sicredi'], ['085', 'Ailos/Viacredi'],
] as const;
const STATUS: Record<string, string> = {
  registration: 'Cadastro recebido: falta a prova de vida',
  affiliation: 'Em análise pela Pagar.me',
  active: 'Conta ativa ✓ — você recebe direto',
  refused: 'Recusada pela Pagar.me — fale com o suporte da MOVI',
  suspended: 'Suspensa — fale com o suporte da MOVI',
  blocked: 'Bloqueada — fale com o suporte da MOVI',
  inactive: 'Inativa — fale com o suporte da MOVI',
};
const dataIso = (t: string) => {
  const m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
};
const num = (t: string) => Number(t.replace(/\./g, '').replace(',', '.'));

/**
 * Conta para receber pela Pagar.me (motorista e lojista): com ela, a parte de cada pagamento vai
 * direto para a conta bancária (split). A Pagar.me confere a identidade por uma prova de vida.
 */
export default function ContaRecebimento() {
  const ehLoja = MODO === 'lojista';
  const { depois } = useLocalSearchParams<{ depois?: string }>(); // veio direto do cadastro
  const papel = ehLoja ? 'lojista' : 'motorista';
  const raiz = ehLoja ? '/v2/loja/recebedor' : '/v2/eu/recebedor';
  const [estado, setEstado] = useState<Estado | null>(null);
  const [temCnpj, setTemCnpj] = useState(false);
  const [f, setF] = useState({
    email: '', nascimento: '', renda: '', profissao: ehLoja ? 'Comerciante' : 'Motorista de aplicativo', mae: '',
    cep: '', rua: '', numero: '', complemento: '', bairro: '', cidade: 'Guaramirim', uf: 'SC',
    banco: '', agencia: '', agenciaDv: '', conta: '', contaDv: '', tipo: 'checking' as 'checking' | 'savings',
    razao: '', faturamento: '', fundacao: '',
  });
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const carregar = useCallback(() => {
    api<Estado>(papel, raiz).then(setEstado).catch((e) => setMsg((e as Error).message));
    if (ehLoja) api<{ cnpj?: string | null }>(papel, '/v2/eu').then((e) => setTemCnpj(!!e.cnpj)).catch(() => {});
  }, [papel, raiz, ehLoja]);
  useFocusEffect(
    useCallback(() => {
      const t = setTimeout(carregar, 0);
      return () => clearTimeout(t);
    }, [carregar]),
  );

  async function abrirKyc(url?: string | null) {
    try {
      const link = url ?? (await api<{ kycUrl: string }>(papel, `${raiz}/kyc`, { method: 'POST' })).kycUrl;
      await WebBrowser.openBrowserAsync(link);
      carregar();
    } catch (e) {
      Alert.alert('Prova de vida', (e as Error).message);
    }
  }

  async function enviar() {
    setEnviando(true);
    setMsg(null);
    try {
      const r = await api<Estado & { kycUrl: string | null }>(papel, raiz, {
        method: 'POST',
        corpo: {
          email: f.email.trim(), nascimento: dataIso(f.nascimento), rendaMensal: num(f.renda), profissao: f.profissao, nomeMae: f.mae || undefined,
          endereco: { cep: f.cep, rua: f.rua, numero: f.numero, complemento: f.complemento, bairro: f.bairro, cidade: f.cidade, uf: f.uf },
          conta: { banco: f.banco, agencia: f.agencia, agenciaDv: f.agenciaDv, conta: f.conta, contaDv: f.contaDv, tipo: f.tipo },
          ...(temCnpj ? { razaoSocial: f.razao, faturamentoAnual: num(f.faturamento), fundacao: dataIso(f.fundacao) } : {}),
        },
      });
      setEstado(r);
      if (r.kycUrl)
        Alert.alert('Falta a prova de vida', 'A Pagar.me vai pedir uma selfie e a foto do documento para liberar a conta.', [
          { text: 'Depois', style: 'cancel' },
          { text: 'Fazer agora', onPress: () => abrirKyc(r.kycUrl) },
        ]);
    } catch (e) {
      setMsg(e instanceof ErroApi ? e.message : 'Não foi possível enviar.');
    } finally {
      setEnviando(false);
    }
  }

  if (!estado) return msg ? <Text style={[s.erro, { padding: 20 }]}>{msg}</Text> : <ActivityIndicator style={{ marginTop: 60 }} color={cores.primaria} />;

  if (estado.temConta)
    return (
      <ScrollView contentContainerStyle={s.conteudo}>
        <Stack.Screen options={{ title: 'Conta para receber' }} />
        <View style={[s.cartao, estado.ativo && { borderColor: cores.sucesso }]}>
          <Text style={s.titulo}>{STATUS[estado.status ?? ''] ?? `Situação: ${estado.status ?? '—'}`}</Text>
          <Text style={s.texto}>
            {estado.ativo
              ? `A sua parte de cada pagamento vai direto para a sua conta bancária, pela Pagar.me.${ehLoja ? ' As vendas do delivery caem direto para a loja.' : ''}`
              : 'Para liberar a conta, a Pagar.me confere a sua identidade com uma selfie e a foto do documento (prova de vida).'}
          </Text>
          {!estado.ativo && (
            <Pressable style={s.botao} onPress={() => abrirKyc()}>
              <Text style={s.botaoTexto}>Fazer a prova de vida</Text>
            </Pressable>
          )}
          <Pressable onPress={carregar}>
            <Text style={s.link}>Atualizar situação</Text>
          </Pressable>
        </View>
        <Text style={s.suave}>Para trocar a conta bancária, fale com o suporte da MOVI.</Text>
      </ScrollView>
    );

  const campo = (k: keyof typeof f, rotulo: string, props: Partial<React.ComponentProps<typeof TextInput>> = {}, metade = false) => (
    <View style={metade ? { gap: 4, flex: 1 } : { gap: 4 }}>
      <Text style={s.rotulo}>{rotulo}</Text>
      <TextInput style={s.input} value={String(f[k])} onChangeText={(t) => setF({ ...f, [k]: t })} placeholderTextColor={cores.apagado} {...props} />
    </View>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.conteudo} keyboardShouldPersistTaps="handled">
        <Stack.Screen options={{ title: depois ? 'Último passo' : 'Conta para receber' }} />
        {!!depois && (
          <View style={s.cartao}>
            <Text style={s.titulo}>Cadastro enviado ✓</Text>
            <Text style={s.texto}>
              Agora cadastre a conta onde você vai receber{ehLoja ? ' as vendas' : ' as corridas'}. Leva uns 3 minutos e depois a Pagar.me pede uma selfie (prova de vida), exigência do Banco Central.
            </Text>
            <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace(ehLoja ? '/lojista' : '/motorista'))} hitSlop={8}>
              <Text style={s.link}>Fazer depois</Text>
            </Pressable>
          </View>
        )}
        {!estado.disponivel && <Text style={s.aviso}>O recebimento direto pela Pagar.me ainda não foi ligado pela MOVI. Você pode voltar aqui depois.</Text>}
        <Text style={s.texto}>
          {ehLoja
            ? 'Com a conta cadastrada, o valor dos produtos vendidos no delivery cai direto na conta da loja.'
            : 'Com a conta cadastrada, o valor de cada corrida cai direto na sua conta, sem esperar o saque.'}{' '}
          A conta bancária precisa estar no {ehLoja && temCnpj ? 'CNPJ da loja' : 'seu CPF'}. Os dados vão para a Pagar.me (Stone), exigidos pelo Banco Central.
        </Text>

        <Text style={s.secao}>Seus dados</Text>
        {campo('email', 'E-mail', { keyboardType: 'email-address', autoCapitalize: 'none', placeholder: 'voce@email.com' })}
        <View style={s.linha}>
          {campo('nascimento', ehLoja ? 'Nascimento do responsável' : 'Data de nascimento', { placeholder: 'DD/MM/AAAA', keyboardType: 'numbers-and-punctuation', maxLength: 10 }, true)}
          {campo('renda', 'Renda mensal (R$)', { placeholder: '3.000', keyboardType: 'decimal-pad' }, true)}
        </View>
        {campo('profissao', 'Profissão')}
        {campo('mae', 'Nome da mãe (opcional)')}
        {ehLoja && temCnpj && (
          <>
            <Text style={s.secao}>Empresa</Text>
            {campo('razao', 'Razão social')}
            <View style={s.linha}>
              {campo('faturamento', 'Faturamento anual (R$)', { keyboardType: 'decimal-pad', placeholder: '120.000' }, true)}
              {campo('fundacao', 'Data de fundação', { placeholder: 'DD/MM/AAAA', keyboardType: 'numbers-and-punctuation', maxLength: 10 }, true)}
            </View>
          </>
        )}

        <Text style={s.secao}>Endereço</Text>
        <View style={s.linha}>
          {campo('cep', 'CEP', { keyboardType: 'number-pad', maxLength: 9, placeholder: '89270-000' }, true)}
          {campo('numero', 'Número', { keyboardType: 'number-pad' }, true)}
        </View>
        {campo('rua', 'Rua')}
        {campo('complemento', 'Complemento (opcional)')}
        {campo('bairro', 'Bairro')}
        <View style={s.linha}>
          {campo('cidade', 'Cidade', {}, true)}
          {campo('uf', 'UF', { maxLength: 2, autoCapitalize: 'characters' }, true)}
        </View>

        <Text style={s.secao}>Conta bancária</Text>
        <View style={s.chips}>
          {BANCOS.map(([cod, nome]) => (
            <Pressable key={cod} style={[s.chip, f.banco === cod && s.chipAtivo]} onPress={() => setF({ ...f, banco: cod })}>
              <Text style={[s.chipTexto, f.banco === cod && { color: cores.primaria }]}>{nome}</Text>
            </Pressable>
          ))}
        </View>
        {campo('banco', 'Código do banco (3 números)', { keyboardType: 'number-pad', maxLength: 3 })}
        <View style={s.linha}>
          {campo('agencia', 'Agência', { keyboardType: 'number-pad', maxLength: 5 }, true)}
          {campo('agenciaDv', 'Dígito (se tiver)', { maxLength: 1 }, true)}
        </View>
        <View style={s.linha}>
          {campo('conta', 'Conta', { keyboardType: 'number-pad', maxLength: 13 }, true)}
          {campo('contaDv', 'Dígito', { maxLength: 2 }, true)}
        </View>
        <View style={s.chips}>
          {(['checking', 'savings'] as const).map((t) => (
            <Pressable key={t} style={[s.chip, f.tipo === t && s.chipAtivo]} onPress={() => setF({ ...f, tipo: t })}>
              <Text style={[s.chipTexto, f.tipo === t && { color: cores.primaria }]}>{t === 'checking' ? 'Conta corrente' : 'Poupança'}</Text>
            </Pressable>
          ))}
        </View>

        {msg && <Text style={s.erro}>{msg}</Text>}
        <Pressable style={[s.botao, (enviando || !estado.disponivel) && { opacity: 0.5 }]} disabled={enviando || !estado.disponivel} onPress={enviar}>
          {enviando ? <ActivityIndicator color="#fff" /> : <Text style={s.botaoTexto}>Cadastrar conta</Text>}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  conteudo: { padding: 20, gap: 10, paddingBottom: 40 },
  cartao: { backgroundColor: cores.cartao, borderRadius: raio + 2, padding: 18, gap: 10, borderWidth: 1, borderColor: cores.borda },
  titulo: { fontSize: 18, fontWeight: '700', color: cores.texto },
  texto: { fontSize: 14, color: cores.suave, lineHeight: 20 },
  suave: { fontSize: 12, color: cores.suave },
  aviso: { backgroundColor: cores.alertaFundo, color: cores.alerta, borderRadius: raio, padding: 12, fontSize: 13, lineHeight: 19 },
  secao: { fontSize: 13, fontWeight: '800', color: cores.primaria, letterSpacing: 1, textTransform: 'uppercase', marginTop: 10 },
  linha: { flexDirection: 'row', gap: 10 },
  rotulo: { fontSize: 13, color: cores.suave },
  input: { backgroundColor: cores.cartao, borderRadius: 12, borderWidth: 1, borderColor: cores.borda, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, color: cores.texto },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18, borderWidth: 1, borderColor: cores.borda },
  chipAtivo: { borderColor: cores.primaria, backgroundColor: cores.primariaClara },
  chipTexto: { color: cores.texto, fontSize: 13, fontWeight: '600' },
  botao: { backgroundColor: cores.primaria, borderRadius: raio, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  botaoTexto: { color: '#fff', fontSize: 16, fontWeight: '700' },
  link: { color: cores.primaria, fontWeight: '700', fontSize: 14, textAlign: 'center', padding: 6 },
  erro: { color: cores.erro, fontSize: 14 },
});
