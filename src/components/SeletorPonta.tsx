import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { cidadeDe, CIDADES, nomeCidade, type CidadeId } from '../data/cidades';
import type { Local } from '../data/locais';
import { CATEGORIAS, categoriasVisiveis, livrePermitido, type CategoriaId, type Ponta, type ServicoId } from '../data/servicos';
import { useApp } from '../estado/AppContext';
import { useCotacoes } from '../hooks/useCotacoes';
import { distanciaRetaKm, formatarReais } from '../services/preco';
import { geocodificar, minhaLocalizacao } from '../services/rota';
import { SOLICITANTE } from '../variante';
import MapaRuas, { type EstadoMapa } from './MapaRuas';
import { cores, raio, sombra } from './tema';

/** O que o cliente escolheu para uma ponta da viagem, já no formato do servidor (`corpo`). */
export type Escolha = {
  chave: string;
  nome: string;
  endereco: string;
  lat: number;
  lon: number;
  corpo: { casa: true } | { localId: string } | { nome: string; endereco: string; lat: number; lon: number };
};

type Lugar = { nome: string; endereco: string; lat: number; lon: number };
const CHAVE_LUGARES = 'lugares:v1';

export const escolhaCasa = (c: { endereco: string; lat: number; lon: number }, quem: 'cliente' | 'lojista' = 'cliente'): Escolha => ({
  chave: 'casa', nome: quem === 'lojista' ? 'Minha loja' : 'Minha casa', endereco: c.endereco, lat: c.lat, lon: c.lon, corpo: { casa: true },
});
const curto = (e: string) => e.split(/, (Guaramirim|Jaraguá do Sul|Schroeder|Massaranduba|Joinville)/)[0];
const escolhaLocal = (l: Local): Escolha => ({ chave: `l:${l.id}`, nome: l.nome, endereco: curto(l.endereco), lat: l.lat, lon: l.lon, corpo: { localId: l.id } });
const escolhaLivre = (l: Lugar): Escolha => ({ chave: `x:${l.nome}:${l.lat}:${l.lon}`, nome: l.nome, endereco: l.endereco, lat: l.lat, lon: l.lon, corpo: { ...l } });

type Props = {
  ponta: Ponta;
  valor: Escolha | null;
  onChange: (e: Escolha) => void;
  servico: ServicoId;
  agendado: boolean;
  /** O outro lado da viagem: com ele, cada local da lista mostra o preço (calculado pelo servidor). */
  base?: { lat: number; lon: number } | null;
};

const MOSTRAR = 8;

export default function SeletorPonta({ ponta, valor, onChange, servico, agendado, base }: Props) {
  const { casa, locais, config } = useApp();
  const categorias = useMemo(() => categoriasVisiveis(ponta, config), [ponta, config]);
  const livreOk = livrePermitido(ponta, config);
  const [catEscolhida, setCat] = useState<CategoriaId | null>(null);
  const cat = useMemo(() => (catEscolhida && categorias.includes(catEscolhida) ? catEscolhida : (categorias[0] ?? null)), [catEscolhida, categorias]);
  const [livre, setLivre] = useState(false);
  const [lugares, setLugares] = useState<Lugar[]>([]);
  const [gpsOcupado, setGpsOcupado] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(CHAVE_LUGARES)
      .then((v) => setLugares(v ? JSON.parse(v) : []))
      .catch(() => {});
  }, [livre]);

  const [todos, setTodos] = useState(false);
  // Os mais perto primeiro (do outro lado da viagem ou da casa), de todas as cidades liberadas.
  const ref = base ?? casa;
  const lista = useMemo(() => {
    const l = locais.filter((x) => x.categoria === cat);
    return ref ? l.sort((a, b) => distanciaRetaKm(a.lat, a.lon, ref.lat, ref.lon) - distanciaRetaKm(b.lat, b.lon, ref.lat, ref.lon)) : l;
  }, [locais, cat, ref]);
  const visiveis = useMemo(() => (todos ? lista : lista.slice(0, MOSTRAR)), [lista, todos]);
  const cot = useCotacoes(servico, agendado, base, visiveis);

  async function usarGps() {
    setMsg(null);
    setGpsOcupado(true);
    try {
      const p = await minhaLocalizacao();
      let endereco = 'Localização atual (GPS)';
      try {
        const r = (await Location.reverseGeocodeAsync({ latitude: p.lat, longitude: p.lon }))[0];
        if (r?.street) endereco = [r.street, r.streetNumber, r.district].filter(Boolean).join(', ');
      } catch {
        // sem nome de rua: fica a posição
      }
      onChange(escolhaLivre({ nome: 'Onde estou agora', endereco, lat: p.lat, lon: p.lon }));
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setGpsOcupado(false);
    }
  }

  return (
    <View style={{ gap: 8 }}>
      <Text style={s.rotulo}>{ponta.rotulo}</Text>

      {ponta.casa && casa && (
        <Opcao
          icone={SOLICITANTE === 'lojista' ? '🏪' : '🏠'}
          titulo={SOLICITANTE === 'lojista' ? 'Minha loja' : 'Minha casa'}
          sub={casa.endereco}
          ativo={valor?.chave === 'casa'}
          onPress={() => onChange(escolhaCasa(casa, SOLICITANTE))}
        />
      )}

      {categorias.length > 0 && (
        <>
          {categorias.length > 1 && (
            <View style={s.chips}>
              {categorias.map((id) => {
                const c = CATEGORIAS.find((x) => x.id === id)!;
                return (
                  <Pressable key={id} style={[s.chip, cat === id && s.chipAtivo]} onPress={() => setCat(id)}>
                    <Text style={[s.chipTexto, cat === id && { color: cores.primaria }]}>
                      {c.icone} {c.nome}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}
          {lista.length === 0 && <Text style={s.vazio}>Nenhum local cadastrado nesta categoria ainda.</Text>}
          {visiveis.map((l) => (
            <Opcao
              key={l.id}
              titulo={l.nome}
              sub={`${curto(l.endereco)} · ${nomeCidade(l.cidade ?? cidadeDe(l))}`}
              direita={base ? (cot[l.id] ? formatarReais(cot[l.id]!.valor) : '…') : undefined}
              ativo={valor?.chave === `l:${l.id}`}
              onPress={() => onChange(escolhaLocal(l))}
            />
          ))}
          {lista.length > MOSTRAR && (
            <Pressable onPress={() => setTodos(!todos)}>
              <Text style={s.mais}>{todos ? 'Mostrar só os mais perto' : `Ver todos (${lista.length})`}</Text>
            </Pressable>
          )}
        </>
      )}

      {ponta.gps && (
        <Opcao
          icone="📍"
          titulo="Onde estou agora"
          sub={valor?.nome === 'Onde estou agora' ? valor.endereco : 'Usar a localização do celular'}
          ativo={valor?.nome === 'Onde estou agora'}
          carregando={gpsOcupado}
          onPress={usarGps}
        />
      )}

      {livreOk &&
        lugares.map((l) => (
          <Opcao key={l.nome} icone="⭐" titulo={l.nome} sub={l.endereco} ativo={valor?.chave === escolhaLivre(l).chave} onPress={() => onChange(escolhaLivre(l))} />
        ))}

      {livreOk && !livre && (
        <Pressable onPress={() => setLivre(true)} style={s.outro}>
          <Text style={s.outroTexto}>✏️ Outro endereço</Text>
        </Pressable>
      )}
      {livreOk && livre && (
        <EnderecoLivre
          onCancelar={() => setLivre(false)}
          onUsar={async (l, salvar) => {
            if (salvar) {
              const novos = [...lugares.filter((x) => x.nome !== l.nome), l].slice(-6);
              await AsyncStorage.setItem(CHAVE_LUGARES, JSON.stringify(novos)).catch(() => {});
              setLugares(novos);
            }
            onChange(escolhaLivre(l));
            setLivre(false);
          }}
        />
      )}
      {valor && valor.chave.startsWith('x:') && !lugares.some((l) => escolhaLivre(l).chave === valor.chave) && valor.nome !== 'Onde estou agora' && (
        <Opcao icone="📌" titulo={valor.nome} sub={valor.endereco} ativo onPress={() => {}} />
      )}
      {msg && <Text style={s.erro}>{msg}</Text>}
    </View>
  );
}

function Opcao(p: { icone?: string; titulo: string; sub?: string; direita?: string; ativo: boolean; carregando?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={p.onPress} style={[s.opcao, p.ativo && s.opcaoAtiva]} accessibilityRole="radio" accessibilityState={{ selected: p.ativo }}>
      {p.icone && <Text style={s.opcaoIcone}>{p.icone}</Text>}
      <View style={{ flex: 1 }}>
        <Text style={[s.opcaoTitulo, p.ativo && { color: cores.primaria }]}>{p.titulo}</Text>
        {p.sub ? (
          <Text style={s.opcaoSub} numberOfLines={1}>
            {p.sub}
          </Text>
        ) : null}
      </View>
      {p.carregando ? <ActivityIndicator color={cores.primaria} /> : p.direita ? <Text style={[s.opcaoValor, p.ativo && { color: cores.primaria }]}>{p.direita}</Text> : null}
    </Pressable>
  );
}

/** Endereço digitado + ponto no mapa (obrigatório, para o preço e a navegação do motorista). */
function EnderecoLivre({ onUsar, onCancelar }: { onUsar: (l: Lugar, salvar: boolean) => void; onCancelar: () => void }) {
  const { casa, config } = useApp();
  const cidades = CIDADES.filter((c) => config.cidadesAtivas.includes(c.id));
  const [cidade, setCidade] = useState<CidadeId>((casa && cidadeDe(casa)) || cidades[0]?.id || 'guaramirim');
  const [nome, setNome] = useState('');
  const [endereco, setEndereco] = useState('');
  const [pin, setPin] = useState<{ lat: number; lon: number } | null>(null);
  const [salvar, setSalvar] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const centro = CIDADES.find((c) => c.id === cidade)?.centro ?? null;
  const estado: EstadoMapa = useMemo(() => ({ modo: 'escolher', casa: pin, centro, mercados: [] }), [pin, centro]);

  async function achar() {
    setMsg(null);
    setOcupado(true);
    try {
      const p = await geocodificar(endereco, cidade);
      if (p) setPin(p);
      else setMsg('Não achei esse endereço. Toque no mapa no ponto certo.');
    } finally {
      setOcupado(false);
    }
  }

  const ok = endereco.trim().length >= 6 && !!pin;
  return (
    <View style={s.livre}>
      {cidades.length > 1 && (
        <View style={s.chips}>
          {cidades.map((c) => (
            <Pressable key={c.id} style={[s.chip, cidade === c.id && s.chipAtivo]} onPress={() => setCidade(c.id)}>
              <Text style={[s.chipTexto, cidade === c.id && { color: cores.primaria }]}>{c.nome}</Text>
            </Pressable>
          ))}
        </View>
      )}
      <TextInput style={s.input} value={nome} onChangeText={setNome} placeholder="Nome (ex.: Trabalho, Correios) — opcional" placeholderTextColor={cores.apagado} maxLength={40} />
      <TextInput
        style={s.input}
        value={endereco}
        onChangeText={setEndereco}
        placeholder="Rua, número e bairro"
        placeholderTextColor={cores.apagado}
        returnKeyType="search"
        onSubmitEditing={() => endereco.trim().length > 4 && achar()}
      />
      <View style={s.linha}>
        <Text style={s.dica}>{pin ? '✓ Ponto marcado. Toque no mapa para ajustar.' : 'Toque no mapa no ponto exato.'}</Text>
        <Pressable onPress={achar} disabled={ocupado || endereco.trim().length < 5}>
          <Text style={[s.link, endereco.trim().length < 5 && { opacity: 0.4 }]}>{ocupado ? 'Buscando…' : '🔎 Achar'}</Text>
        </Pressable>
      </View>
      <MapaRuas estado={estado} onEscolher={setPin} style={{ height: 260 }} />
      <Pressable onPress={() => setSalvar(!salvar)} style={s.linha}>
        <Text style={s.dica}>{salvar ? '☑' : '☐'} Salvar nos meus lugares</Text>
      </Pressable>
      {msg && <Text style={s.erro}>{msg}</Text>}
      <View style={s.linha}>
        <Pressable onPress={onCancelar}>
          <Text style={[s.link, { color: cores.suave }]}>Cancelar</Text>
        </Pressable>
        <Pressable
          style={[s.usar, !ok && { opacity: 0.45 }]}
          disabled={!ok}
          onPress={() => pin && onUsar({ nome: nome.trim() || endereco.trim().split(',')[0], endereco: endereco.trim(), lat: pin.lat, lon: pin.lon }, salvar)}
        >
          <Text style={s.usarTexto}>Usar este endereço</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  rotulo: { fontSize: 16, fontWeight: '700', color: cores.texto, marginTop: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: cores.cartao, borderWidth: 1, borderColor: cores.borda },
  chipAtivo: { backgroundColor: cores.primariaClara, borderColor: cores.primaria },
  chipTexto: { fontSize: 14, fontWeight: '600', color: cores.texto },
  vazio: { fontSize: 13, color: cores.suave },
  mais: { color: cores.primaria, fontWeight: '700', fontSize: 14, textAlign: 'center', paddingVertical: 6 },
  opcao: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: cores.cartao, borderRadius: raio, borderWidth: 1.5, borderColor: 'transparent', padding: 14, ...sombra },
  opcaoAtiva: { borderColor: cores.primaria, backgroundColor: cores.primariaClara },
  opcaoIcone: { fontSize: 22 },
  opcaoTitulo: { fontSize: 15, fontWeight: '600', color: cores.texto },
  opcaoSub: { fontSize: 13, color: cores.suave, marginTop: 1 },
  opcaoValor: { fontSize: 16, fontWeight: '700', color: cores.texto, fontVariant: ['tabular-nums'] },
  outro: { paddingVertical: 12, alignItems: 'center', borderRadius: raio, backgroundColor: cores.primariaClara },
  outroTexto: { color: cores.primaria, fontWeight: '700', fontSize: 15 },
  livre: { backgroundColor: cores.cartao, borderRadius: raio, padding: 12, gap: 8, ...sombra },
  input: { backgroundColor: cores.fundo, borderRadius: 12, borderWidth: 1, borderColor: cores.borda, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, color: cores.texto },
  linha: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  dica: { fontSize: 13, color: cores.suave, flexShrink: 1 },
  link: { color: cores.primaria, fontWeight: '700', fontSize: 15, paddingVertical: 4 },
  usar: { backgroundColor: cores.primaria, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 16 },
  usarTexto: { color: '#fff', fontWeight: '700', fontSize: 15 },
  erro: { color: cores.erro, fontSize: 13 },
});
