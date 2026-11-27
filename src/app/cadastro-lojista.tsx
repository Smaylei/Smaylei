import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import CampoEndereco from '../components/CampoEndereco';
import CamposSenha, { senhaOk } from '../components/CamposSenha';
import { BotaoInicio } from '../components/Marca';
import { cores, raio, sombra } from '../components/tema';
import { useApp } from '../estado/AppContext';
import { api, ErroApi, guardarToken } from '../services/api';
import { cpfValido, formatarCpf } from '../services/cpf';

const formatarCnpj = (t: string) =>
  t
    .replace(/\D/g, '')
    .slice(0, 14)
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');

/** Cadastro da loja: depois de aprovada pela MOVI, a loja pede transporte das compras e dos clientes dela. */
export default function CadastroLojista() {
  const { casa, temConta, eu, salvarCasa, recarregarEu, config } = useApp();
  const [loja, setLoja] = useState(eu?.lojaNome ?? '');
  const [cnpj, setCnpj] = useState('');
  const [nome, setNome] = useState(eu?.nome ?? '');
  const [cpf, setCpf] = useState('');
  const [telefone, setTelefone] = useState(casa?.telefone ?? '');
  const [endereco, setEndereco] = useState(casa?.endereco ?? '');
  const [pin, setPin] = useState<{ lat: number; lon: number } | null>(casa ? { lat: casa.lat, lon: casa.lon } : null);
  const [senha, setSenha] = useState('');
  const [confirma, setConfirma] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const faltando = [
    loja.trim().length < 2 && 'nome da loja',
    cnpj.replace(/\D/g, '').length > 0 && cnpj.replace(/\D/g, '').length !== 14 && 'CNPJ completo',
    nome.trim().split(' ').length < 2 && 'nome do responsável',
    !temConta && !cpfValido(cpf) && 'CPF do responsável',
    telefone.replace(/\D/g, '').length < 10 && 'telefone com DDD',
    endereco.trim().length < 5 && 'endereço da loja',
    !pin && 'a loja marcada no mapa',
    !temConta && !senhaOk(senha, confirma) && 'senha (mínimo 6, igual nas duas)',
  ].filter(Boolean) as string[];

  async function salvar() {
    if (faltando.length || !pin) return;
    setOcupado(true);
    setMsg(null);
    try {
      if (!temConta) {
        const r = await api<{ token: string }>(null, '/v2/lojistas', {
          method: 'POST',
          corpo: { lojaNome: loja.trim(), cnpj, nome: nome.trim(), cpf, telefone, senha, endereco: endereco.trim(), lat: pin.lat, lon: pin.lon },
        });
        await guardarToken('lojista', r.token);
      } else {
        await api('lojista', '/v2/eu', { method: 'PUT', corpo: { nome: nome.trim(), telefone, endereco: endereco.trim(), lat: pin.lat, lon: pin.lon } });
      }
      await salvarCasa({ nome: loja.trim(), endereco: endereco.trim(), telefone, lat: pin.lat, lon: pin.lon });
      recarregarEu();
      router.replace('/lojista');
      // Pagar.me ligada: logo depois do cadastro, a conta para receber as vendas (dados bancários + prova de vida).
      if (!temConta && config.gateway === 'pagarme') router.push({ pathname: '/conta-recebimento', params: { depois: '1' } });
    } catch (e) {
      setMsg(e instanceof ErroApi ? e.message : 'Sem conexão. Tente de novo.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={s.conteudo} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: temConta ? 'Dados da loja' : 'Cadastro de lojista', headerLeft: temConta ? undefined : () => <BotaoInicio /> }} />
      {!temConta && (
        <Text style={s.intro}>Cadastre sua loja para chamar motoristas que levam as compras (e o cliente, se quiser) até a casa do seu cliente. A MOVI confere e aprova o cadastro.</Text>
      )}

      <Text style={s.rotulo}>Nome da loja</Text>
      <TextInput style={s.input} value={loja} onChangeText={setLoja} placeholder="Ex.: Mercado Bom Preço" placeholderTextColor={cores.apagado} editable={!temConta} />
      {!temConta && (
        <>
          <Text style={s.rotulo}>CNPJ (opcional para MEI ainda sem CNPJ)</Text>
          <TextInput style={s.input} value={cnpj} onChangeText={(t) => setCnpj(formatarCnpj(t))} placeholder="00.000.000/0000-00" placeholderTextColor={cores.apagado} keyboardType="number-pad" />
        </>
      )}
      <Text style={s.rotulo}>Responsável</Text>
      <TextInput style={s.input} value={nome} onChangeText={setNome} placeholder="Nome completo" placeholderTextColor={cores.apagado} autoComplete="name" />
      {!temConta && (
        <>
          <Text style={s.rotulo}>CPF do responsável</Text>
          <TextInput
            style={[s.input, cpf.length >= 14 && !cpfValido(cpf) && { borderColor: cores.erro }]}
            value={cpf}
            onChangeText={(t) => setCpf(formatarCpf(t))}
            placeholder="000.000.000-00"
            placeholderTextColor={cores.apagado}
            keyboardType="number-pad"
          />
        </>
      )}
      <Text style={s.rotulo}>Telefone / WhatsApp da loja</Text>
      <TextInput style={s.input} value={telefone} onChangeText={setTelefone} placeholder="(47) 99999-9999" placeholderTextColor={cores.apagado} keyboardType="phone-pad" />

      <CampoEndereco rotulo="Endereço da loja (rua, número e bairro)" endereco={endereco} onEndereco={setEndereco} pin={pin} onPin={setPin} gps="Estou na loja" />

      {!temConta && <CamposSenha senha={senha} confirma={confirma} onSenha={setSenha} onConfirma={setConfirma} />}

      {msg && <Text style={s.erro}>{msg}</Text>}
      {faltando.length > 0 && <Text style={s.falta}>Falta: {faltando.join(', ')}.</Text>}
      <Pressable style={[s.botao, (faltando.length > 0 || ocupado) && { opacity: 0.45 }]} disabled={faltando.length > 0 || ocupado} onPress={salvar}>
        {ocupado ? <ActivityIndicator color="#fff" /> : <Text style={s.botaoTexto}>{temConta ? 'Salvar' : 'Enviar cadastro'}</Text>}
      </Pressable>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  conteudo: { padding: 16, paddingBottom: 40, gap: 6 },
  intro: { fontSize: 15, color: cores.texto, marginBottom: 6, lineHeight: 21 },
  rotulo: { fontSize: 13, color: cores.suave, marginTop: 8 },
  input: { backgroundColor: cores.cartao, ...sombra, borderRadius: raio, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: cores.texto },
  erro: { color: cores.erro, fontSize: 14 },
  falta: { color: cores.suave, fontSize: 13, marginTop: 6 },
  botao: { backgroundColor: cores.primaria, borderRadius: raio, paddingVertical: 16, alignItems: 'center', marginTop: 10 },
  botaoTexto: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
