import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import MapaRuas, { type EstadoMapa } from '../components/MapaRuas';
import { cores, raio } from '../components/tema';
import { MERCADOS } from '../data/mercados';
import { useApp } from '../estado/AppContext';
import { acharRua } from '../services/grafo';
import { geocodificar, minhaLocalizacao } from '../services/rota';

const CURTO: Record<string, string> = { cooper: 'Cooper', komprao: 'Komprão', burei: 'Burei', 'super-tres': 'Super Três', martini: 'Martini' };

export default function Cadastro() {
  const { casa, salvarCasa } = useApp();
  const [nome, setNome] = useState(casa && casa.nome !== 'Minha casa' ? casa.nome : '');
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
        const texto = /guaramirim/i.test(endereco) ? endereco : `${endereco}, Guaramirim - SC`;
        const p = await geocodificar(texto);
        if (p) setPin(p);
        else setMsg('Não achei esse endereço. Toque no mapa no ponto da sua casa.');
      }
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function salvar() {
    if (!pin) return;
    await salvarCasa({
      nome: nome.trim() || 'Minha casa',
      endereco: endereco.trim() || 'Local marcado no mapa',
      lat: pin.lat,
      lon: pin.lon,
    });
    router.replace('/');
  }

  return (
    <ScrollView contentContainerStyle={s.conteudo} keyboardShouldPersistTaps="handled">
      {!casa && <Text style={s.intro}>Cadastre seu endereço uma vez. Depois é só pedir o frete.</Text>}

      <Text style={s.rotulo}>Seu nome</Text>
      <TextInput style={s.input} value={nome} onChangeText={setNome} placeholder="Ex.: Ana" placeholderTextColor={cores.suave} />

      <Text style={s.rotulo}>Endereço (rua, número e bairro)</Text>
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
        {pin
          ? '✓ Casa marcada. Se precisar, toque no mapa para ajustar.'
          : rua
            ? `Rua encontrada: ${rua}. Toque no mapa no ponto da sua casa.`
            : 'Toque no mapa no ponto exato da sua casa.'}
      </Text>

      <MapaRuas estado={estado} onEscolher={setPin} style={{ height: 340 }} />

      <View style={s.linha}>
        <Pressable style={s.botaoSec} onPress={() => localizar('gps')} disabled={ocupado}>
          <Text style={s.botaoSecTexto}>📍 Estou em casa</Text>
        </Pressable>
        <Pressable style={s.botaoSec} onPress={() => localizar('endereco')} disabled={ocupado || endereco.trim().length < 5}>
          <Text style={[s.botaoSecTexto, endereco.trim().length < 5 && { opacity: 0.4 }]}>🔎 Achar endereço</Text>
        </Pressable>
        {ocupado && <ActivityIndicator color={cores.primaria} />}
      </View>
      {msg && <Text style={s.erro}>{msg}</Text>}

      <Pressable style={[s.botao, !pin && { opacity: 0.45 }]} disabled={!pin} onPress={salvar}>
        <Text style={s.botaoTexto}>Salvar endereço</Text>
      </Pressable>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  conteudo: { padding: 16, paddingBottom: 40, gap: 6 },
  intro: { fontSize: 15, color: cores.texto, marginBottom: 6 },
  rotulo: { fontSize: 13, color: cores.suave, marginTop: 8 },
  input: {
    backgroundColor: cores.cartao,
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: cores.texto,
  },
  passo: { fontSize: 13, color: cores.primaria, fontWeight: '600', marginVertical: 8 },
  linha: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 4 },
  botaoSec: { paddingVertical: 10 },
  botaoSecTexto: { color: cores.primaria, fontWeight: '700', fontSize: 15 },
  erro: { color: cores.erro, fontSize: 14 },
  botao: { backgroundColor: cores.primaria, borderRadius: raio, paddingVertical: 16, alignItems: 'center', marginTop: 12 },
  botaoTexto: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
