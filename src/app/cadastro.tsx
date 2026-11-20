import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import CampoFoto from '../components/CampoFoto';
import MapaRuas, { type EstadoMapa } from '../components/MapaRuas';
import { cores, raio } from '../components/tema';
import { MERCADOS } from '../data/mercados';
import { useApp } from '../estado/AppContext';
import { api, enviarFoto, ErroApi, guardarToken } from '../services/api';
import { cpfValido, formatarCpf } from '../services/cpf';
import { acharRua } from '../services/grafo';
import { geocodificar, minhaLocalizacao } from '../services/rota';

const CURTO: Record<string, string> = { cooper: 'Cooper', komprao: 'Komprão', burei: 'Burei', 'super-tres': 'Super Três', martini: 'Martini' };

export default function Cadastro() {
  const { casa, temConta, salvarCasa } = useApp();
  const [nome, setNome] = useState(casa && casa.nome !== 'Minha casa' ? casa.nome : '');
  const [cpf, setCpf] = useState(casa?.cpf ? formatarCpf(casa.cpf) : '');
  const [telefone, setTelefone] = useState(casa?.telefone ?? '');
  const [foto, setFoto] = useState<string | null>(null);
  const [endereco, setEndereco] = useState(casa?.endereco ?? '');
  const [pin, setPin] = useState<{ lat: number; lon: number } | null>(casa ? { lat: casa.lat, lon: casa.lon } : null);
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const rua = useMemo(() => acharRua(endereco), [endereco]);
  const estado: EstadoMapa = useMemo(
    () => ({
      modo: 'escolher',
      casa: pin,
      rua,
      mercados: MERCADOS.map((m) => ({ id: m.id, curto: CURTO[m.id] ?? m.nome, lat: m.lat, lon: m.lon })),
    }),
    [pin, rua],
  );

  async function localizar(como: 'gps' | 'endereco') {
    setMsg(null);
    setOcupado(true);
    try {
      if (como === 'gps') setPin(await minhaLocalizacao());
      else {
        const p = await geocodificar(/guaramirim/i.test(endereco) ? endereco : `${endereco}, Guaramirim - SC`);
        if (p) setPin(p);
        else setMsg('Não achei esse endereço. Toque no mapa no ponto da sua casa.');
      }
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  const faltando = [
    nome.trim().split(' ').length < 2 && 'nome completo',
    !cpfValido(cpf) && 'CPF válido',
    telefone.replace(/\D/g, '').length < 10 && 'WhatsApp com DDD',
    !temConta && !foto && 'sua foto',
    endereco.trim().length < 5 && 'endereço',
    !pin && 'a casa marcada no mapa',
  ].filter(Boolean) as string[];

  async function salvar() {
    if (faltando.length || !pin) return;
    setOcupado(true);
    setMsg(null);
    const dados = { nome: nome.trim(), cpf, telefone, endereco: endereco.trim(), lat: pin.lat, lon: pin.lon };
    try {
      if (!temConta) {
        const r = await api<{ token: string }>(null, '/v2/clientes', { method: 'POST', corpo: dados });
        await guardarToken('cliente', r.token);
      } else {
        await api('cliente', '/v2/eu', { method: 'PUT', corpo: dados });
      }
      let temFoto = casa?.temFoto ?? false;
      if (foto) {
        // Se o armazenamento de fotos ainda não estiver ativo no servidor, segue sem a foto.
        temFoto = await enviarFoto('cliente', 'foto', foto)
          .then(() => true)
          .catch((e) => (e instanceof ErroApi && e.status === 503 ? temFoto : Promise.reject(e)));
      }
      await salvarCasa({ ...dados, cpf: cpf.replace(/\D/g, ''), temFoto });
      router.replace('/');
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={s.conteudo} keyboardShouldPersistTaps="handled">
      {!temConta && <Text style={s.intro}>Cadastre-se uma vez. Depois é só pedir ou agendar o frete.</Text>}

      <CampoFoto rotulo="Sua foto" uri={foto} onFoto={setFoto} frontal enviada={casa?.temFoto} />

      <Text style={s.rotulo}>Nome completo</Text>
      <TextInput style={s.input} value={nome} onChangeText={setNome} placeholder="Ex.: Ana Souza" placeholderTextColor={cores.suave} autoComplete="name" />

      <Text style={s.rotulo}>CPF</Text>
      <TextInput
        style={[s.input, cpf.length >= 14 && !cpfValido(cpf) && { borderColor: cores.erro }]}
        value={cpf}
        onChangeText={(t) => setCpf(formatarCpf(t))}
        placeholder="000.000.000-00"
        placeholderTextColor={cores.suave}
        keyboardType="number-pad"
        editable={!temConta}
      />

      <Text style={s.rotulo}>WhatsApp</Text>
      <TextInput
        style={s.input}
        value={telefone}
        onChangeText={setTelefone}
        placeholder="(47) 99999-9999"
        placeholderTextColor={cores.suave}
        keyboardType="phone-pad"
        autoComplete="tel"
      />

      <Text style={s.rotulo}>Endereço de entrega (rua, número e bairro)</Text>
      <TextInput
        style={s.input}
        value={endereco}
        onChangeText={setEndereco}
        placeholder="Ex.: Rua 28 de Agosto, 1200, Centro"
        placeholderTextColor={cores.suave}
        returnKeyType="search"
        onSubmitEditing={() => endereco.trim().length > 4 && localizar('endereco')}
      />
      <Text style={s.passo}>
        {pin ? '✓ Casa marcada. Toque no mapa para ajustar.' : rua ? `Rua encontrada: ${rua}. Toque no mapa no ponto da sua casa.` : 'Toque no mapa no ponto exato da sua casa.'}
      </Text>

      <MapaRuas estado={estado} onEscolher={setPin} style={{ height: 320 }} />

      <View style={s.linha}>
        <Pressable onPress={() => localizar('gps')} disabled={ocupado}>
          <Text style={s.link}>📍 Estou em casa</Text>
        </Pressable>
        <Pressable onPress={() => localizar('endereco')} disabled={ocupado || endereco.trim().length < 5}>
          <Text style={[s.link, endereco.trim().length < 5 && { opacity: 0.4 }]}>🔎 Achar endereço</Text>
        </Pressable>
      </View>

      {msg && <Text style={s.erro}>{msg}</Text>}
      {faltando.length > 0 && <Text style={s.falta}>Falta: {faltando.join(', ')}.</Text>}

      <Pressable style={[s.botao, (faltando.length > 0 || ocupado) && { opacity: 0.45 }]} disabled={faltando.length > 0 || ocupado} onPress={salvar}>
        {ocupado ? <ActivityIndicator color="#fff" /> : <Text style={s.botaoTexto}>{temConta ? 'Salvar' : 'Criar cadastro'}</Text>}
      </Pressable>
      <Text style={s.lgpd}>Seus dados (CPF e foto) são usados só para identificar você ao motorista e para a segurança das entregas.</Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  conteudo: { padding: 16, paddingBottom: 40, gap: 6 },
  intro: { fontSize: 15, color: cores.texto, marginBottom: 6 },
  rotulo: { fontSize: 13, color: cores.suave, marginTop: 8 },
  input: { backgroundColor: cores.cartao, borderWidth: 1, borderColor: cores.borda, borderRadius: raio, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: cores.texto },
  passo: { fontSize: 13, color: cores.primaria, fontWeight: '600', marginVertical: 8 },
  linha: { flexDirection: 'row', gap: 20, marginTop: 6 },
  link: { color: cores.primaria, fontWeight: '700', fontSize: 15, paddingVertical: 6 },
  erro: { color: cores.erro, fontSize: 14 },
  falta: { color: cores.suave, fontSize: 13, marginTop: 6 },
  botao: { backgroundColor: cores.primaria, borderRadius: raio, paddingVertical: 16, alignItems: 'center', marginTop: 10 },
  botaoTexto: { color: '#fff', fontSize: 17, fontWeight: '700' },
  lgpd: { fontSize: 11, color: cores.suave, textAlign: 'center', marginTop: 8 },
});
