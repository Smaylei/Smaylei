import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { TARIFAS_PADRAO } from '../data/tarifas';
import { URGENCIA_PADRAO, type Tarifa, type Urgencia } from '../services/preco';
import { cores, raio } from './tema';

type Props = {
  tarifas: Tarifa[];
  margem: number;
  urgencia: Urgencia;
  /** R$ a mais para o motorista no pedido agora (o resto da urgência fica com a MOVI). */
  incentivo: number;
  comissaoPct: number;
  onSalvar: (t: Tarifa[], margem: number, urgencia: Urgencia, incentivo: number) => void;
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

export default function TelaTarifas({ tarifas, margem, urgencia, incentivo, comissaoPct, onSalvar }: Props) {
  // Estado inicial vem das props; o App remonta esta tela (key) quando os valores salvos mudam.
  const [rascunho, setRascunho] = useState<Record<string, Record<CampoNum, string>>>(() => {
    const r: Record<string, Record<CampoNum, string>> = {};
    for (const t of tarifas) {
      r[t.id] = {
        tarifaBase: paraTexto(t.tarifaBase),
        porKm: paraTexto(t.porKm),
        porMinuto: paraTexto(t.porMinuto),
        tarifaMinima: paraTexto(t.tarifaMinima),
      };
    }
    return r;
  });
  const [margemTxt, setMargemTxt] = useState(paraTexto(margem));
  const [urgTipo, setUrgTipo] = useState<Urgencia['tipo']>(urgencia.tipo);
  const [urgTxt, setUrgTxt] = useState(paraTexto(urgencia.valor));
  const [incTxt, setIncTxt] = useState(paraTexto(incentivo));
  const [msg, setMsg] = useState<string | null>(null);

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
    const u = paraNumero(urgTxt);
    if (!Number.isFinite(u) || u < 0) {
      setMsg('Acréscimo de urgência inválido.');
      return;
    }
    const inc = paraNumero(incTxt);
    if (!Number.isFinite(inc) || inc < 0 || inc > 100) {
      setMsg('Incentivo do motorista inválido.');
      return;
    }
    onSalvar(novas, m, { tipo: urgTipo, valor: u }, inc);
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

      <View style={s.cartao}>
        <Text style={s.titulo}>Entrega urgente</Text>
        <Text style={s.rotulo}>Acréscimo no frete quando o cliente não agenda (entrega agora)</Text>
        <View style={s.tipos}>
          {(['percentual', 'reais'] as const).map((t) => (
            <Pressable
              key={t}
              onPress={() => setUrgTipo(t)}
              style={[s.tipo, urgTipo === t && s.tipoAtivo]}
              accessibilityRole="radio"
              accessibilityState={{ selected: urgTipo === t }}
            >
              <Text style={[s.tipoTexto, urgTipo === t && { color: '#fff' }]}>{t === 'percentual' ? 'Em %' : 'Em R$'}</Text>
            </Pressable>
          ))}
        </View>
        <TextInput style={s.input} keyboardType="decimal-pad" value={urgTxt} onChangeText={setUrgTxt} />
        <Text style={[s.rotulo, { marginTop: 6 }]}>Entrega agendada usa o preço calculado, sem acréscimo.</Text>
        <Text style={[s.rotulo, { marginTop: 12 }]}>Incentivo ao motorista no pedido agora (R$)</Text>
        <TextInput style={s.input} keyboardType="decimal-pad" value={incTxt} onChangeText={setIncTxt} />
        <Text style={[s.rotulo, { marginTop: 6 }]}>
          Só o Admin vê a taxa de urgência. O motorista recebe {comissaoPct}% do frete sem a urgência + este incentivo (no máximo o valor da urgência); o restante
          da urgência fica com a MOVI. O motorista nunca vê o valor pago pelo cliente.
        </Text>
      </View>

      <Pressable style={s.botao} onPress={salvar}>
        <Text style={s.botaoTexto}>Salvar tarifas</Text>
      </Pressable>
      <Pressable style={s.botaoSec} onPress={() => onSalvar(TARIFAS_PADRAO, 0, URGENCIA_PADRAO, 4)}>
        <Text style={s.botaoSecTexto}>Restaurar valores padrão</Text>
      </Pressable>
      {msg && <Text style={s.msg}>{msg}</Text>}
      <Pressable style={s.botaoSec} onPress={() => router.push({ pathname: '/servicos-admin', params: { secao: 'moto' } })}>
        <Text style={s.botaoSecTexto}>🏍️ Tabela do motoboy (moto) ›</Text>
      </Pressable>
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
  tipos: { flexDirection: 'row', gap: 8, marginVertical: 8 },
  tipo: { borderWidth: 1, borderColor: cores.borda, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 14 },
  tipoAtivo: { backgroundColor: cores.primaria, borderColor: cores.primaria },
  tipoTexto: { fontWeight: '600', color: cores.texto },
  botao: { backgroundColor: cores.primaria, borderRadius: raio, paddingVertical: 15, alignItems: 'center' },
  botaoTexto: { color: '#fff', fontSize: 16, fontWeight: '700' },
  botaoSec: { paddingVertical: 12, alignItems: 'center' },
  botaoSecTexto: { color: cores.primaria, fontWeight: '600' },
  msg: { textAlign: 'center', color: cores.texto, marginTop: 4 },
});
