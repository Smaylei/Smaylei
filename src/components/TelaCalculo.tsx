import { useCallback, useEffect, useState } from 'react';
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
import { carregarEndereco, salvarEndereco, type Endereco } from '../services/cadastro';
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
  type ResultadoRota,
} from '../services/rota';
import { cores, raio } from './tema';

type Props = { tarifas: Tarifa[]; margem: number };
type Cotacao = { rota: ResultadoRota; estimativas: Estimativa[]; sugerido: number };

export default function TelaCalculo({ tarifas, margem }: Props) {
  const [casa, setCasa] = useState<Endereco | null>(null);
  const [carregado, setCarregado] = useState(false);
  const [editando, setEditando] = useState(false);
  const [rotas, setRotas] = useState<Record<string, ResultadoRota | null>>({});
  const [calculando, setCalculando] = useState(false);
  const [sel, setSel] = useState<string>(MERCADOS[0].id);

  useEffect(() => {
    carregarEndereco().then((e) => {
      setCasa(e);
      setEditando(!e);
      setCarregado(true);
    });
  }, []);

  // Assim que houver endereço, calcula a rota ida e volta de todos os mercados.
  const calcularTodos = useCallback(async (c: Endereco) => {
    setCalculando(true);
    const destino = { lat: c.lat, lon: c.lon };
    const pares = await Promise.all(
      MERCADOS.map(async (m) => {
        try {
          return [m.id, await calcularIdaEVolta(await pontoDoMercado(m), destino)] as const;
        } catch {
          return [m.id, null] as const;
        }
      }),
    );
    setRotas(Object.fromEntries(pares));
    setCalculando(false);
  }, []);

  useEffect(() => {
    if (casa) calcularTodos(casa);
  }, [casa, calcularTodos]);

  const cotar = (r: ResultadoRota): Cotacao => {
    const estimativas = tarifas.map((t) => estimarIdaEVolta(r, t));
    return { rota: r, estimativas, sugerido: precoSugerido(estimativas, margem) };
  };

  if (!carregado) return <ActivityIndicator style={{ marginTop: 40 }} color={cores.primaria} />;

  const mercado = MERCADOS.find((m) => m.id === sel) ?? MERCADOS[0];
  const rotaSel = rotas[mercado.id];

  return (
    <ScrollView contentContainerStyle={s.conteudo} keyboardShouldPersistTaps="handled">
      {editando || !casa ? (
        <FormCadastro
          inicial={casa}
          onCancelar={casa ? () => setEditando(false) : undefined}
          onSalvo={(e) => {
            setCasa(e);
            setEditando(false);
            salvarEndereco(e).catch(() => {});
          }}
        />
      ) : (
        <View style={s.cartao}>
          <Text style={s.rotulo}>Meu endereço</Text>
          <View style={s.linhaCasa}>
            <View style={{ flex: 1 }}>
              <Text style={s.casaNome}>{casa.nome}</Text>
              <Text style={s.detalhe}>{casa.endereco}</Text>
            </View>
            <Pressable onPress={() => setEditando(true)} style={s.botaoBorda}>
              <Text style={s.botaoBordaTexto}>Alterar</Text>
            </Pressable>
          </View>
        </View>
      )}

      {casa && !editando && (
        <>
          <Text style={s.secao}>Escolha o mercado</Text>
          <View style={s.listaMercados}>
            {MERCADOS.map((m) => {
              const r = rotas[m.id];
              const ativo = m.id === sel;
              return (
                <Pressable
                  key={m.id}
                  onPress={() => setSel(m.id)}
                  style={[s.mercado, ativo && s.mercadoAtivo]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: ativo }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[s.mercadoNome, ativo && s.mercadoNomeAtivo]}>{m.nome}</Text>
                    <Text style={s.mercadoEnd} numberOfLines={1}>
                      {m.endereco.split(', Guaramirim')[0]}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    {calculando && r === undefined ? (
                      <ActivityIndicator color={cores.primaria} />
                    ) : r ? (
                      <>
                        <Text style={s.mercadoValor}>{formatarReais(cotar(r).sugerido)}</Text>
                        <Text style={s.mercadoEnd}>{formatarKm(r.kmIda + r.kmVolta)} ida e volta</Text>
                      </>
                    ) : (
                      <Text style={s.mercadoEnd}>sem rota</Text>
                    )}
                  </View>
                </Pressable>
              );
            })}
          </View>
          {rotaSel && <CartaoResultado mercado={mercado} c={cotar(rotaSel)} margem={margem} />}
        </>
      )}
    </ScrollView>
  );
}

function FormCadastro({
  inicial,
  onSalvo,
  onCancelar,
}: {
  inicial: Endereco | null;
  onSalvo: (e: Endereco) => void;
  onCancelar?: () => void;
}) {
  const [nome, setNome] = useState(inicial?.nome ?? '');
  const [endereco, setEndereco] = useState(inicial?.endereco ?? '');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvarPorEndereco() {
    setErro(null);
    if (endereco.trim().length < 5) {
      setErro('Digite rua, número e bairro.');
      return;
    }
    setOcupado(true);
    try {
      const texto = /guaramirim|jaragu|schroeder|massaranduba|joinville|\bsc\b/i.test(endereco)
        ? endereco
        : `${endereco}, Guaramirim - SC`;
      const p = await geocodificar(texto);
      if (!p) throw new Error('Endereço não encontrado. Confira rua, número e bairro, ou use sua localização.');
      onSalvo({ nome: nome.trim() || 'Minha casa', endereco: endereco.trim(), lat: p.lat, lon: p.lon });
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function salvarPorLocalizacao() {
    setErro(null);
    setOcupado(true);
    try {
      const p = await minhaLocalizacao();
      onSalvo({
        nome: nome.trim() || 'Minha casa',
        endereco: endereco.trim() || 'Localização salva pelo GPS',
        lat: p.lat,
        lon: p.lon,
      });
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <View style={s.cartao}>
      <Text style={s.titulo}>Meu endereço</Text>
      <Text style={s.detalhe}>Cadastre uma vez. Depois é só tocar no mercado que o frete aparece.</Text>
      <Text style={s.campoRotulo}>Nome</Text>
      <TextInput style={s.input} value={nome} onChangeText={setNome} placeholder="Ex.: Ana" placeholderTextColor={cores.suave} />
      <Text style={s.campoRotulo}>Endereço (rua, número e bairro)</Text>
      <TextInput
        style={s.input}
        value={endereco}
        onChangeText={setEndereco}
        placeholder="Ex.: Rua 28 de Agosto, 1200, Centro"
        placeholderTextColor={cores.suave}
        returnKeyType="done"
        onSubmitEditing={salvarPorEndereco}
      />
      <Pressable onPress={salvarPorEndereco} style={[s.botao, ocupado && { opacity: 0.6 }]} disabled={ocupado}>
        {ocupado ? <ActivityIndicator color="#fff" /> : <Text style={s.botaoTexto}>Salvar endereço</Text>}
      </Pressable>
      <Pressable onPress={salvarPorLocalizacao} style={s.botaoSec} disabled={ocupado}>
        <Text style={s.botaoSecTexto}>📍 Estou em casa: usar minha localização</Text>
      </Pressable>
      {onCancelar && (
        <Pressable onPress={onCancelar} style={s.botaoSec}>
          <Text style={[s.botaoSecTexto, { color: cores.suave }]}>Cancelar</Text>
        </Pressable>
      )}
      {erro && <Text style={s.erro}>{erro}</Text>}
    </View>
  );
}

function CartaoResultado({ mercado, c, margem }: { mercado: Mercado; c: Cotacao; margem: number }) {
  const { rota } = c;
  const kmTotal = rota.kmIda + rota.kmVolta;
  const minTotal = Math.round(rota.minIda + rota.minVolta);
  return (
    <View style={[s.cartao, { marginTop: 16 }]}>
      <Text style={s.rotulo}>Percurso</Text>
      <Text style={s.trajeto}>
        {mercado.nome} → casa → {mercado.nome}
      </Text>
      <View style={s.linhaKm}>
        <Metrica titulo="Ida" valor={formatarKm(rota.kmIda)} />
        <Metrica titulo="Volta" valor={formatarKm(rota.kmVolta)} />
        <Metrica titulo="Total" valor={formatarKm(kmTotal)} destaque />
        <Metrica titulo="Tempo" valor={`${minTotal} min`} />
      </View>
      {rota.fonte === 'estimada' && (
        <Text style={s.aviso}>Sem acesso ao serviço de rotas: distância estimada pela linha reta × 1,35.</Text>
      )}

      <Text style={[s.rotulo, { marginTop: 16 }]}>Preço estimado (ida + volta)</Text>
      {c.estimativas.map((e) => (
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
        <Text style={s.sugeridoRotulo}>Valor do frete{margem ? ` (média + ${margem}%)` : ' (média Uber e 99)'}</Text>
        <Text style={s.sugeridoValor}>{formatarReais(c.sugerido)}</Text>
        <Text style={s.detalhe}>{formatarReais(kmTotal > 0 ? c.sugerido / kmTotal : 0)} por km rodado</Text>
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
  secao: { fontSize: 15, fontWeight: '700', color: cores.texto, marginTop: 20, marginBottom: 8 },
  titulo: { fontSize: 17, fontWeight: '700', color: cores.texto },
  listaMercados: { gap: 8 },
  mercado: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
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
  mercadoValor: { fontSize: 17, fontWeight: '700', color: cores.texto, fontVariant: ['tabular-nums'] },
  linhaCasa: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6 },
  casaNome: { fontSize: 16, fontWeight: '700', color: cores.texto },
  campoRotulo: { fontSize: 13, color: cores.suave, marginTop: 12, marginBottom: 4 },
  input: {
    backgroundColor: cores.fundo,
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: raio,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: cores.texto,
  },
  botao: { backgroundColor: cores.primaria, borderRadius: raio, paddingVertical: 15, alignItems: 'center', marginTop: 14 },
  botaoTexto: { color: '#fff', fontSize: 16, fontWeight: '700' },
  botaoSec: { paddingVertical: 10, alignSelf: 'flex-start' },
  botaoSecTexto: { color: cores.primaria, fontWeight: '600', fontSize: 14 },
  botaoBorda: { borderWidth: 1, borderColor: cores.borda, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14 },
  botaoBordaTexto: { color: cores.texto, fontWeight: '600' },
  erro: { color: cores.erro, marginTop: 8, fontSize: 14 },
  cartao: { backgroundColor: cores.cartao, borderRadius: raio, padding: 16, borderWidth: 1, borderColor: cores.borda },
  rotulo: { fontSize: 12, fontWeight: '700', color: cores.suave, textTransform: 'uppercase', letterSpacing: 0.5 },
  trajeto: { fontSize: 14, color: cores.texto, marginTop: 4 },
  linhaKm: { flexDirection: 'row', marginTop: 12, gap: 8 },
  metrica: { flex: 1, backgroundColor: cores.fundo, borderRadius: 10, padding: 8, alignItems: 'center' },
  metricaTitulo: { fontSize: 11, color: cores.suave },
  metricaValor: { fontSize: 14, fontWeight: '700', color: cores.texto, marginTop: 2 },
  aviso: { marginTop: 10, backgroundColor: cores.alertaFundo, color: cores.alerta, padding: 8, borderRadius: 8, fontSize: 12 },
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
