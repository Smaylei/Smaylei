import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useApp } from '../estado/AppContext';
import { api, type CorridaCliente, type Gorjeta } from '../services/api';
import { irParaPagamento } from '../services/pagamento';
import { SOLICITANTE } from '../variante';
import { formatarReais } from '../services/preco';
import { cores, raio, sombra } from './tema';

const GORJETAS = [0, 2, 5, 10];
const FRASE = ['', 'Ruim', 'Poderia ser melhor', 'Bom', 'Muito bom', 'Excelente!'];

/**
 * Fim do atendimento: nota de 1 a 5, gorjeta opcional (100% para o motorista, Pix ou cartão)
 * e caixa de sugestões, que só a administração lê.
 */
export default function AvaliarFrete({ c, onAtualizar }: { c: CorridaCliente; onAtualizar: (c: CorridaCliente) => void }) {
  const { config } = useApp();
  const [nota, setNota] = useState(0);
  const [gorjeta, setGorjeta] = useState(0);
  const [outro, setOutro] = useState('');
  const [usandoOutro, setUsandoOutro] = useState(false);
  const [sugestao, setSugestao] = useState('');
  const [enviando, setEnviando] = useState(false);
  const nome = c.motorista?.nome ?? 'o motorista';
  const avaliado = c.avaliacao != null;
  const valorGorjeta = usandoOutro ? Math.round(Number(outro.replace(',', '.')) * 100) / 100 || 0 : gorjeta;

  if (avaliado && c.gorjeta != null)
    return (
      <View style={[s.cartao, s.obrigado]}>
        <Text style={s.obrigadoTitulo}>Obrigado! 💚</Text>
        <Text style={s.texto}>
          Você deu {c.avaliacao} {c.avaliacao === 1 ? 'estrela' : 'estrelas'} e {formatarReais(c.gorjeta)} de gorjeta para {nome}.
        </Text>
      </View>
    );

  async function enviar() {
    if (!avaliado && !nota) return Alert.alert('Avaliação', 'Toque nas estrelas para dar sua nota.');
    if (valorGorjeta && (valorGorjeta < 1 || valorGorjeta > 200)) return Alert.alert('Gorjeta', 'Escolha um valor entre R$ 1 e R$ 200.');
    setEnviando(true);
    try {
      if (!avaliado) {
        const atual = await api<CorridaCliente>(SOLICITANTE, `/v2/corridas/${c.id}/avaliar`, { method: 'POST', corpo: { nota, sugestao: sugestao.trim() || undefined } });
        onAtualizar(atual);
      }
      if (valorGorjeta > 0) {
        const g = await api<Gorjeta>(SOLICITANTE, `/v2/corridas/${c.id}/gorjeta`, { method: 'POST', corpo: { valor: valorGorjeta } });
        irParaPagamento(config.gateway, 'gorjeta', g.id, { corrida: c.id });
      }
    } catch (e) {
      Alert.alert('Não foi possível enviar', (e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <View style={s.cartao}>
      {!avaliado ? (
        <>
          <Text style={s.titulo}>Como foi o seu frete?</Text>
          <Text style={s.texto}>Sua opinião sobre {nome} e o serviço ajuda a melhorar.</Text>
          <View style={s.estrelas}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Pressable key={n} onPress={() => setNota(n)} hitSlop={6} accessibilityLabel={`${n} estrelas`}>
                <Text style={[s.estrela, { color: n <= nota ? cores.estrela : cores.borda }]}>★</Text>
              </Pressable>
            ))}
          </View>
          <Text style={s.frase}>{FRASE[nota] || ' '}</Text>
        </>
      ) : (
        <>
          <Text style={s.titulo}>Obrigado pela avaliação! 💚</Text>
          <Text style={s.texto}>Quer agradecer {nome} com uma gorjeta?</Text>
        </>
      )}

      <Text style={s.rotulo}>Gorjeta para {nome} (opcional)</Text>
      <View style={s.chips}>
        {GORJETAS.map((v) => {
          const ativo = !usandoOutro && gorjeta === v;
          return (
            <Pressable
              key={v}
              style={[s.chip, ativo && s.chipAtivo]}
              onPress={() => {
                setUsandoOutro(false);
                setGorjeta(v);
              }}
            >
              <Text style={[s.chipTexto, ativo && s.chipTextoAtivo]}>{v ? `R$ ${v}` : 'Sem'}</Text>
            </Pressable>
          );
        })}
        <Pressable style={[s.chip, usandoOutro && s.chipAtivo]} onPress={() => setUsandoOutro(true)}>
          <Text style={[s.chipTexto, usandoOutro && s.chipTextoAtivo]}>Outro</Text>
        </Pressable>
      </View>
      {usandoOutro && (
        <TextInput
          style={s.campo}
          value={outro}
          onChangeText={setOutro}
          keyboardType="decimal-pad"
          placeholder="Valor em R$ (ex.: 7)"
          placeholderTextColor={cores.apagado}
          maxLength={6}
        />
      )}
      <Text style={s.dica}>100% da gorjeta vai para o motorista. Pix ou cartão à vista.</Text>

      {!avaliado && (
        <>
          <Text style={s.rotulo}>Sugestões de melhoria</Text>
          <TextInput
            style={[s.campo, s.campoGrande]}
            value={sugestao}
            onChangeText={setSugestao}
            multiline
            maxLength={1000}
            placeholder="O que podemos fazer melhor? (opcional)"
            placeholderTextColor={cores.apagado}
            textAlignVertical="top"
          />
          <Text style={s.dica}>🔒 Só a administração lê. O motorista não vê o que você escrever.</Text>
        </>
      )}

      <Pressable style={[s.botao, (enviando || (avaliado && !valorGorjeta)) && { opacity: 0.5 }]} onPress={enviar} disabled={enviando || (avaliado && !valorGorjeta)}>
        {enviando ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={s.botaoTexto}>
            {avaliado ? `Dar gorjeta de ${formatarReais(valorGorjeta)}` : valorGorjeta ? `Enviar e dar ${formatarReais(valorGorjeta)}` : 'Enviar avaliação'}
          </Text>
        )}
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  cartao: { backgroundColor: cores.cartao, borderRadius: raio, padding: 18, gap: 8, ...sombra },
  obrigado: { backgroundColor: cores.primariaClara, shadowOpacity: 0, elevation: 0 },
  obrigadoTitulo: { fontSize: 18, fontWeight: '700', color: cores.primaria },
  titulo: { fontSize: 19, fontWeight: '700', color: cores.texto },
  texto: { fontSize: 14, color: cores.suave, lineHeight: 20 },
  estrelas: { flexDirection: 'row', justifyContent: 'center', gap: 10, marginTop: 6 },
  estrela: { fontSize: 42 },
  frase: { textAlign: 'center', color: cores.suave, fontSize: 14, fontWeight: '600' },
  rotulo: { fontSize: 13, fontWeight: '700', color: cores.texto, marginTop: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 999, backgroundColor: cores.fundo, borderWidth: 1, borderColor: cores.borda },
  chipAtivo: { backgroundColor: cores.primariaClara, borderColor: cores.primaria },
  chipTexto: { fontSize: 15, color: cores.texto, fontWeight: '600' },
  chipTextoAtivo: { color: cores.primaria },
  campo: { backgroundColor: cores.fundo, borderRadius: 12, borderWidth: 1, borderColor: cores.borda, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: cores.texto },
  campoGrande: { minHeight: 90 },
  dica: { fontSize: 12, color: cores.suave },
  botao: { backgroundColor: cores.primaria, borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 8 },
  botaoTexto: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
