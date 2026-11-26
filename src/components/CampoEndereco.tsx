import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { cidadeDe, CIDADES, type CidadeId } from '../data/cidades';
import { useApp } from '../estado/AppContext';
import { geocodificar, minhaLocalizacao } from '../services/rota';
import MapaRuas, { type EstadoMapa } from './MapaRuas';
import { cores, raio, sombra } from './tema';

type Ponto = { lat: number; lon: number };
type Props = {
  rotulo: string;
  endereco: string;
  onEndereco: (e: string) => void;
  pin: Ponto | null;
  onPin: (p: Ponto) => void;
  /** Texto do botão de GPS (ex.: "Estou em casa", "Estou na loja"). */
  gps: string;
};

/** Cidade + endereço + ponto no mapa (o ponto é o que vale para o preço e a navegação). */
export default function CampoEndereco({ rotulo, endereco, onEndereco, pin, onPin, gps }: Props) {
  const { config } = useApp();
  const cidades = CIDADES.filter((c) => config.cidadesAtivas.includes(c.id));
  const [cidade, setCidade] = useState<CidadeId>((pin && cidadeDe(pin)) || 'guaramirim');
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const centro = CIDADES.find((c) => c.id === cidade)?.centro ?? null;
  const estado: EstadoMapa = useMemo(() => ({ modo: 'escolher', casa: pin, centro, mercados: [] }), [pin, centro]);

  async function localizar(como: 'gps' | 'endereco') {
    setMsg(null);
    setOcupado(true);
    try {
      const p = como === 'gps' ? await minhaLocalizacao() : await geocodificar(endereco, cidade);
      if (!p) setMsg('Não achei esse endereço. Toque no mapa no ponto certo.');
      else {
        const c = cidadeDe(p);
        if (!c || !config.cidadesAtivas.includes(c)) setMsg('Esse ponto fica fora das cidades atendidas.');
        else {
          setCidade(c);
          onPin(p);
        }
      }
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <View style={{ gap: 8 }}>
      <Text style={s.rotulo}>Cidade</Text>
      <View style={s.chips}>
        {cidades.map((c) => (
          <Pressable key={c.id} style={[s.chip, cidade === c.id && s.chipAtivo]} onPress={() => setCidade(c.id)}>
            <Text style={[s.chipTexto, cidade === c.id && { color: cores.primaria }]}>{c.nome}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={s.rotulo}>{rotulo}</Text>
      <TextInput
        style={s.input}
        value={endereco}
        onChangeText={onEndereco}
        placeholder="Ex.: Rua 28 de Agosto, 1200, Centro"
        placeholderTextColor={cores.apagado}
        returnKeyType="search"
        onSubmitEditing={() => endereco.trim().length > 4 && localizar('endereco')}
      />
      <Text style={s.passo}>{pin ? '✓ Ponto marcado. Toque no mapa para ajustar.' : 'Toque no mapa no ponto exato.'}</Text>
      <MapaRuas estado={estado} onEscolher={onPin} style={{ height: 300 }} />
      <View style={s.linha}>
        <Pressable onPress={() => localizar('gps')} disabled={ocupado}>
          <Text style={s.link}>📍 {gps}</Text>
        </Pressable>
        <Pressable onPress={() => localizar('endereco')} disabled={ocupado || endereco.trim().length < 5}>
          <Text style={[s.link, endereco.trim().length < 5 && { opacity: 0.4 }]}>{ocupado ? 'Buscando…' : '🔎 Achar endereço'}</Text>
        </Pressable>
      </View>
      {msg && <Text style={s.erro}>{msg}</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  rotulo: { fontSize: 14, fontWeight: '600', color: cores.suave, marginTop: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: cores.cartao, borderWidth: 1, borderColor: cores.borda },
  chipAtivo: { backgroundColor: cores.primariaClara, borderColor: cores.primaria },
  chipTexto: { fontSize: 14, fontWeight: '600', color: cores.texto },
  input: { backgroundColor: cores.cartao, borderRadius: raio, padding: 14, fontSize: 16, color: cores.texto, ...sombra },
  passo: { fontSize: 13, color: cores.primaria, fontWeight: '600' },
  linha: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  link: { color: cores.primaria, fontWeight: '700', fontSize: 15, paddingVertical: 6 },
  erro: { color: cores.erro, fontSize: 13 },
});
