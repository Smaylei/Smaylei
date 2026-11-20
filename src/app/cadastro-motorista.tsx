import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import CampoFoto from '../components/CampoFoto';
import { cores, raio } from '../components/tema';
import { api, enviarFoto, ErroApi, guardarToken, lerToken } from '../services/api';
import { cpfValido, formatarCpf } from '../services/cpf';

type Eu = { nome: string; telefone: string; carro: string; placa: string; cor?: string; pix?: string; temSelfie: boolean; temCnh: boolean };

export default function CadastroMotorista() {
  const [temConta, setTemConta] = useState(false);
  const [eu, setEu] = useState<Eu | null>(null);
  const [nome, setNome] = useState('');
  const [cpf, setCpf] = useState('');
  const [telefone, setTelefone] = useState('');
  const [carro, setCarro] = useState('');
  const [cor, setCor] = useState('');
  const [placa, setPlaca] = useState('');
  const [selfie, setSelfie] = useState<string | null>(null);
  const [cnh, setCnh] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      lerToken('motorista').then((t) => {
        setTemConta(!!t);
        if (t)
          api<Eu>('motorista', '/v2/eu')
            .then((e) => {
              setEu(e);
              setNome(e.nome);
              setTelefone(e.telefone);
              setCarro(e.carro);
              setPlaca(e.placa);
              setCor(e.cor ?? '');
            })
            .catch(() => {});
      });
    }, []),
  );

  const placaOk = /^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(placa.toUpperCase().replace(/[^A-Z0-9]/g, ''));
  const faltando = temConta
    ? [!eu?.temSelfie && !selfie && 'selfie', !eu?.temCnh && !cnh && 'foto da CNH'].filter(Boolean)
    : [
        nome.trim().split(' ').length < 2 && 'nome completo',
        !cpfValido(cpf) && 'CPF válido',
        telefone.replace(/\D/g, '').length < 10 && 'WhatsApp',
        carro.trim().length < 2 && 'carro',
        !placaOk && 'placa',
        !selfie && 'selfie',
        !cnh && 'foto da CNH',
      ].filter(Boolean);

  async function salvar() {
    setOcupado(true);
    setMsg(null);
    try {
      if (!temConta) {
        const r = await api<{ token: string }>(null, '/v2/motoristas', { method: 'POST', corpo: { nome: nome.trim(), cpf, telefone, carro, placa, cor } });
        await guardarToken('motorista', r.token);
        setTemConta(true);
      }
      const envia = async (tipo: 'selfie' | 'cnh', uri: string | null) => {
        if (!uri) return;
        await enviarFoto('motorista', tipo, uri).catch((e) => {
          if (!(e instanceof ErroApi && e.status === 503)) throw e; // armazenamento ainda não ativado no servidor
        });
      };
      await envia('selfie', selfie);
      await envia('cnh', cnh);
      router.replace('/motorista');
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={s.conteudo} keyboardShouldPersistTaps="handled">
      <Text style={s.intro}>
        {temConta ? 'Complete seus documentos para começar a receber corridas.' : 'Cadastre-se como motorista parceiro. Depois da análise dos documentos, você já pode ficar online.'}
      </Text>

      <CampoFoto rotulo="Selfie (rosto visível)" uri={selfie} onFoto={setSelfie} frontal enviada={eu?.temSelfie} />
      <CampoFoto rotulo="Foto da CNH (aberta)" uri={cnh} onFoto={setCnh} formato="documento" enviada={eu?.temCnh} />

      {!temConta && (
        <>
          <Campo rotulo="Nome completo" valor={nome} onChange={setNome} />
          <Campo
            rotulo="CPF"
            valor={cpf}
            onChange={(t) => setCpf(formatarCpf(t))}
            teclado="number-pad"
            erro={cpf.length >= 14 && !cpfValido(cpf)}
            exemplo="000.000.000-00"
          />
          <Campo rotulo="WhatsApp" valor={telefone} onChange={setTelefone} teclado="phone-pad" exemplo="(47) 99999-9999" />
          <Campo rotulo="Carro (modelo)" valor={carro} onChange={setCarro} exemplo="Ex.: Fiat Strada" />
          <Campo rotulo="Cor" valor={cor} onChange={setCor} exemplo="Ex.: Branca" />
          <Campo rotulo="Placa" valor={placa} onChange={(t) => setPlaca(t.toUpperCase())} exemplo="ABC1D23" erro={placa.length >= 7 && !placaOk} />
          <Text style={s.lgpd}>Seus saques vão por Pix para a chave CPF informada acima.</Text>
        </>
      )}
      {temConta && eu && (
        <Text style={s.dados}>
          {eu.nome} · {eu.carro} {eu.placa}
        </Text>
      )}

      {msg && <Text style={s.erro}>{msg}</Text>}
      {faltando.length > 0 && <Text style={s.falta}>Falta: {faltando.join(', ')}.</Text>}
      <Pressable style={[s.botao, (faltando.length > 0 || ocupado) && { opacity: 0.45 }]} disabled={faltando.length > 0 || ocupado} onPress={salvar}>
        {ocupado ? <ActivityIndicator color="#fff" /> : <Text style={s.botaoTexto}>{temConta ? 'Enviar documentos' : 'Enviar cadastro'}</Text>}
      </Pressable>
      <Text style={s.lgpd}>Os documentos são vistos só pela administração, para aprovar o seu cadastro. O cliente vê seu primeiro nome, foto, carro e placa durante a corrida.</Text>
    </ScrollView>
  );
}

function Campo(p: { rotulo: string; valor: string; onChange: (t: string) => void; teclado?: 'number-pad' | 'phone-pad'; exemplo?: string; erro?: boolean }) {
  return (
    <>
      <Text style={s.rotulo}>{p.rotulo}</Text>
      <TextInput
        style={[s.input, p.erro && { borderColor: cores.erro }]}
        value={p.valor}
        onChangeText={p.onChange}
        keyboardType={p.teclado}
        placeholder={p.exemplo}
        placeholderTextColor={cores.suave}
        autoCapitalize={p.rotulo === 'Placa' ? 'characters' : 'sentences'}
      />
    </>
  );
}

const s = StyleSheet.create({
  conteudo: { padding: 16, paddingBottom: 40, gap: 8 },
  intro: { fontSize: 15, color: cores.texto, marginBottom: 4 },
  rotulo: { fontSize: 13, color: cores.suave, marginTop: 6 },
  input: { backgroundColor: cores.cartao, borderWidth: 1, borderColor: cores.borda, borderRadius: raio, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: cores.texto },
  dados: { fontSize: 15, color: cores.texto, fontWeight: '600' },
  erro: { color: cores.erro, fontSize: 14 },
  falta: { color: cores.suave, fontSize: 13 },
  botao: { backgroundColor: cores.primaria, borderRadius: raio, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  botaoTexto: { color: '#fff', fontSize: 17, fontWeight: '700' },
  lgpd: { fontSize: 11, color: cores.suave, textAlign: 'center', marginTop: 6 },
});
