import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { MERCADOS, type Mercado } from '../data/mercados';
import {
  estimarIdaEVolta,
  formatarKm,
  formatarReais,
  precoSugerido,
  type Estimativa,
  type Tarifa,
} from '../services/preco';
import {
  calcularIdaEVolta,
  geocodificar,
  minhaLocalizacao,
  pontoDoMercado,
  type Ponto,
  type ResultadoRota,
} from '../services/rota';
import { cores, raio } from './tema';

type Props = { tarifas: Tarifa[]; margem: number };

type Resultado = { rota: ResultadoRota; estimativas: Estimativa[]; sugerido: number; mercado: Mercado };

export default function TelaCalculo({ tarifas, margem }: Props) {
  const [mercado, setMercado] = useState<Mercado>(MERCADOS[0]);
  const [endereco, setEndereco] = useState('');
  const [localAtual, setLocalAtual] = useState<Ponto | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  async function usarMinhaLocalizacao() {
    setErro(null);
    try {
      setCarregando(true);
      const p = await minhaLocalizacao();
      setLocalAtual(p);
      setEndereco('');
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }

  async function calcular() {
    setErro(null);
    setResultado(null);
    if (!localAtual && endereco.trim().length < 5) {
      setErro('Digite o endereço de entrega ou use sua localização.');
      return;
    }
    setCarregando(true);
    try {
      let cliente = localAtual;
      if (!cliente) {
        const texto = /guaramirim|jaragu|schroeder|massaranduba|joinville|\bsc\b/i.test(endereco)
          ? endereco
          : `${endereco}, Guaramirim - SC`;
        cliente = await geocodificar(texto);
        if (!cliente) throw new Error('Endereço não encontrado. Inclua rua, número e bairro.');
      }
      const origem = await pontoDoMercado(mercado);
      const rota = await calcularIdaEVolta(origem, cliente);
      const estimativas = tarifas.map((t) => estimarIdaEVolta(rota, t));
      setResultado({ rota, estimativas, sugerido: precoSugerido(estimativas, margem), mercado });
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={s.conteudo} keyboardShouldPersistTaps="handled">
      <Text style={s.secao}>1. Mercado de partida</Text>
      <View style={s.listaMercados}>
        {MERCADOS.map((m) => {
          const ativo = m.id === mercado.id;
          return (
            <Pressable
              key={m.id}
              onPress={() => setMercado(m)}
              style={[s.mercado, ativo && s.mercadoAtivo]}
              accessibilityRole="radio"
              accessibilityState={{ selected: ativo }}
            >
              <Text style={[s.mercadoNome, ativo && s.mercadoNomeAtivo]}>{m.nome}</Text>
              <Text style={s.mercadoEnd} numberOfLines={1}>
                {m.endereco.split(', Guaramirim')[0]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={s.secao}>2. Endereço de entrega</Text>
      <TextInput
        style={s.input}
        placeholder="Ex.: Rua João Butschardt, 100, Centro"
        placeholderTextColor={cores.suave}
        value={localAtual ? 'Minha localização atual' : endereco}
        onChangeText={(t) => {
          setLocalAtual(null);
          setEndereco(t);
        }}
        returnKeyType="search"
        onSubmitEditing={calcular}
      />
      <Pressable onPress={usarMinhaLocalizacao} style={s.botaoSec}>
        <Text style={s.botaoSecTexto}>📍 Usar minha localização</Text>
      </Pressable>

      <Pressable onPress={calcular} style={[s.botao, carregando && { opacity: 0.6 }]} disabled={carregando}>
        {carregando ? <ActivityIndicator color="#fff" /> : <Text style={s.botaoTexto}>Calcular ida e volta</Text>}
      </Pressable>

      {erro && <Text style={s.erro}>{erro}</Text>}

      {resultado && <CartaoResultado r={resultado} margem={margem} />}
    </ScrollView>
  );
}

function CartaoResultado({ r, margem }: { r: Resultado; margem: number }) {
  const { rota } = r;
  const kmTotal = rota.kmIda + rota.kmVolta;
  const minTotal = Math.round(rota.minIda + rota.minVolta);
  return (
    <View style={s.cartao}>
      <Text style={s.rotulo}>Percurso</Text>
      <Text style={s.trajeto}>
        {r.mercado.nome} → cliente → {r.mercado.nome}
      </Text>
      <View style={s.linhaKm}>
        <Metrica titulo="Ida" valor={formatarKm(rota.kmIda)} />
        <Metrica titulo="Volta" valor={formatarKm(rota.kmVolta)} />
        <Metrica titulo="Total" valor={formatarKm(kmTotal)} destaque />
        <Metrica titulo="Tempo" valor={`${minTotal} min`} />
      </View>
      {rota.fonte === 'estimada' && (
        <Text style={s.aviso}>
          Sem acesso ao serviço de rotas: distância estimada pela linha reta × 1,35. Confira a conexão.
        </Text>
      )}

      <Text style={[s.rotulo, { marginTop: 16 }]}>Preço estimado (ida + volta)</Text>
      {r.estimativas.map((e) => (
        <View key={e.tarifa.id} style={s.linhaPreco}>
          <View style={[s.selo, { backgroundColor: e.tarifa.plataforma === 'Uber' ? cores.uber : cores.noventaENove }]}>
            <Text style={[s.seloTexto, { color: e.tarifa.plataforma === 'Uber' ? '#fff' : '#000' }]}>
              {e.tarifa.plataforma}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.categoria}>{e.tarifa.categoria}</Text>
            <Text style={s.detalhe}>
              {e.aplicouMinima
                ? 'Tarifa mínima aplicada'
                : `Base ${formatarReais(e.tarifa.tarifaBase)} + km ${formatarReais(e.valorKm)} + tempo ${formatarReais(e.valorTempo)}`}
            </Text>
          </View>
          <Text style={s.valor}>{formatarReais(e.valor)}</Text>
        </View>
      ))}

      <View style={s.sugerido}>
        <Text style={s.sugeridoRotulo}>
          Valor sugerido para o frete{margem ? ` (média + ${margem}%)` : ' (média)'}
        </Text>
        <Text style={s.sugeridoValor}>{formatarReais(r.sugerido)}</Text>
        <Text style={s.detalhe}>
          {formatarReais(kmTotal > 0 ? r.sugerido / kmTotal : 0)} por km rodado
        </Text>
      </View>
      <Text style={s.notaRodape}>
        Estimativa com base nas tarifas configuradas. Uber e 99 aplicam preço dinâmico; o valor real pode variar.
      </Text>
    </View>
  );
}

function Metrica({ titulo, valor, destaque }: { titulo: string; valor: string; destaque?: boolean }) {
  return (
    <View style={s.metrica}>
      <Text style={s.metricaTitulo}>{titulo}</Text>
      <Text style={[s.metricaValor, destaque && { color: cores.primaria }]}>{valor}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  conteudo: { padding: 16, paddingBottom: 40 },
  secao: { fontSize: 15, fontWeight: '700', color: cores.texto, marginTop: 8, marginBottom: 8 },
  listaMercados: { gap: 8 },
  mercado: {
    backgroundColor: cores.cartao,
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  mercadoAtivo: { borderColor: cores.primaria, backgroundColor: cores.primariaClara, borderWidth: 2 },
  mercadoNome: { fontSize: 15, fontWeight: '600', color: cores.texto },
  mercadoNomeAtivo: { color: cores.primaria },
  mercadoEnd: { fontSize: 12, color: cores.suave, marginTop: 2 },
  input: {
    backgroundColor: cores.cartao,
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: cores.texto,
  },
  botaoSec: { paddingVertical: 10, alignSelf: 'flex-start' },
  botaoSecTexto: { color: cores.primaria, fontWeight: '600', fontSize: 14 },
  botao: {
    backgroundColor: cores.primaria,
    borderRadius: raio,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 4,
  },
  botaoTexto: { color: '#fff', fontSize: 16, fontWeight: '700' },
  erro: { color: cores.erro, marginTop: 12, fontSize: 14 },
  cartao: {
    backgroundColor: cores.cartao,
    borderRadius: raio,
    padding: 16,
    marginTop: 20,
    borderWidth: 1,
    borderColor: cores.borda,
  },
  rotulo: { fontSize: 12, fontWeight: '700', color: cores.suave, textTransform: 'uppercase', letterSpacing: 0.5 },
  trajeto: { fontSize: 14, color: cores.texto, marginTop: 4 },
  linhaKm: { flexDirection: 'row', marginTop: 12, gap: 8 },
  metrica: { flex: 1, backgroundColor: cores.fundo, borderRadius: 10, padding: 8, alignItems: 'center' },
  metricaTitulo: { fontSize: 11, color: cores.suave },
  metricaValor: { fontSize: 14, fontWeight: '700', color: cores.texto, marginTop: 2 },
  aviso: {
    marginTop: 10,
    backgroundColor: cores.alertaFundo,
    color: cores.alerta,
    padding: 8,
    borderRadius: 8,
    fontSize: 12,
  },
  linhaPreco: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: cores.borda,
  },
  selo: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  seloTexto: { fontWeight: '800', fontSize: 13 },
  categoria: { fontSize: 15, fontWeight: '600', color: cores.texto },
  detalhe: { fontSize: 12, color: cores.suave, marginTop: 2 },
  valor: { fontSize: 17, fontWeight: '700', color: cores.texto, fontVariant: ['tabular-nums'] },
  sugerido: { marginTop: 14, backgroundColor: cores.primariaClara, borderRadius: 12, padding: 14 },
  sugeridoRotulo: { fontSize: 13, color: cores.primaria, fontWeight: '600' },
  sugeridoValor: { fontSize: 28, fontWeight: '800', color: cores.primaria, marginTop: 2 },
  notaRodape: { fontSize: 11, color: cores.suave, marginTop: 12 },
});
