import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { TARIFAS_PADRAO } from '../data/tarifas';
import type { Tarifa } from '../services/preco';
import { cores, raio } from './tema';

type Props = {
  tarifas: Tarifa[];
  margem: number;
  onSalvar: (t: Tarifa[], margem: number) => void;
};

type CampoNum = 'tarifaBase' | 'porKm' | 'porMinuto' | 'tarifaMinima';
const CAMPOS: { chave: CampoNum; rotulo: string }[] = [
  { chave: 'tarifaBase', rotulo: 'Tarifa base (R$)' },
  { chave: 'porKm', rotulo: 'Por km (R$)' },
  { chave: 'porMinuto', rotulo: 'Por minuto (R$)' },
  { chave: 'tarifaMinima', rotulo: 'Tarifa mínima (R$)' },
];

const paraTexto = (n: number) => String(n).replace('.', ',');
const paraNumero = (t: string) => Number(t.replace(',', '.'));

export default function TelaTarifas({ tarifas, margem, onSalvar }: Props) {
  const [rascunho, setRascunho] = useState<Record<string, Record<CampoNum, string>>>({});
  const [margemTxt, setMargemTxt] = useState(paraTexto(margem));
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const r: Record<string, Record<CampoNum, string>> = {};
    for (const t of tarifas) {
      r[t.id] = {
        tarifaBase: paraTexto(t.tarifaBase),
        porKm: paraTexto(t.porKm),
        porMinuto: paraTexto(t.porMinuto),
        tarifaMinima: paraTexto(t.tarifaMinima),
      };
    }
    setRascunho(r);
    setMargemTxt(paraTexto(margem));
  }, [tarifas, margem]);

  function salvar() {
    const novas: Tarifa[] = [];
    for (const t of tarifas) {
      const campos = rascunho[t.id];
      const nova = { ...t };
      for (const { chave, rotulo } of CAMPOS) {
        const v = paraNumero(campos[chave]);
        if (!Number.isFinite(v) || v < 0) {
          setMsg(`Valor inválido em ${t.categoria} → ${rotulo}.`);
          return;
        }
        nova[chave] = v;
      }
      novas.push(nova);
    }
    const m = paraNumero(margemTxt);
    if (!Number.isFinite(m) || m < 0) {
      setMsg('Margem inválida.');
      return;
    }
    onSalvar(novas, m);
    setMsg('Tarifas salvas.');
  }

  return (
    <ScrollView contentContainerStyle={s.conteudo} keyboardShouldPersistTaps="handled">
      <Text style={s.intro}>
        Uber e 99 não publicam tabela oficial nem API de preços. Para calibrar, simule uma corrida em cada app
        (mesma origem e destino) e ajuste os valores até o resultado bater.
      </Text>

      {tarifas.map((t) => (
        <View key={t.id} style={s.cartao}>
          <Text style={s.titulo}>
            {t.plataforma} · {t.categoria}
          </Text>
          <View style={s.grade}>
            {CAMPOS.map(({ chave, rotulo }) => (
              <View key={chave} style={s.campo}>
                <Text style={s.rotulo}>{rotulo}</Text>
                <TextInput
                  style={s.input}
                  keyboardType="decimal-pad"
                  value={rascunho[t.id]?.[chave] ?? ''}
                  onChangeText={(v) =>
                    setRascunho((r) => ({ ...r, [t.id]: { ...r[t.id], [chave]: v } }))
                  }
                />
              </View>
            ))}
          </View>
        </View>
      ))}

      <View style={s.cartao}>
        <Text style={s.titulo}>Margem do app</Text>
        <Text style={s.rotulo}>Acréscimo sobre a média Uber/99 (%)</Text>
        <TextInput style={s.input} keyboardType="decimal-pad" value={margemTxt} onChangeText={setMargemTxt} />
      </View>

      <Pressable style={s.botao} onPress={salvar}>
        <Text style={s.botaoTexto}>Salvar tarifas</Text>
      </Pressable>
      <Pressable style={s.botaoSec} onPress={() => onSalvar(TARIFAS_PADRAO, 0)}>
        <Text style={s.botaoSecTexto}>Restaurar valores padrão</Text>
      </Pressable>
      {msg && <Text style={s.msg}>{msg}</Text>}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  conteudo: { padding: 16, paddingBottom: 40 },
  intro: { fontSize: 13, color: cores.suave, marginBottom: 12, lineHeight: 19 },
  cartao: {
    backgroundColor: cores.cartao,
    borderRadius: raio,
    borderWidth: 1,
    borderColor: cores.borda,
    padding: 14,
    marginBottom: 12,
  },
  titulo: { fontSize: 16, fontWeight: '700', color: cores.texto, marginBottom: 8 },
  grade: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  campo: { width: '47%' },
  rotulo: { fontSize: 12, color: cores.suave, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 15,
    color: cores.texto,
    backgroundColor: cores.fundo,
  },
  botao: { backgroundColor: cores.primaria, borderRadius: raio, paddingVertical: 15, alignItems: 'center' },
  botaoTexto: { color: '#fff', fontSize: 16, fontWeight: '700' },
  botaoSec: { paddingVertical: 12, alignItems: 'center' },
  botaoSecTexto: { color: cores.primaria, fontWeight: '600' },
  msg: { textAlign: 'center', color: cores.texto, marginTop: 4 },
});
