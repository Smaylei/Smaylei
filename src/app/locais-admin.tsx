import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import MapaRuas, { type EstadoMapa } from '../components/MapaRuas';
import { cores, raio, sombra } from '../components/tema';
import { CATEGORIAS, type CategoriaId } from '../data/servicos';
import * as Admin from '../services/admin';
import { cidadeDe, CIDADES, nomeCidade, type CidadeId } from '../data/cidades';
import { geocodificar } from '../services/rota';

type Edicao = { id?: string; categoria: CategoriaId; nome: string; endereco: string; pin: { lat: number; lon: number } | null; cidade?: CidadeId };

/** Locais que aparecem para os clientes, por categoria. Tudo que muda aqui vale na hora nos apps. */
export default function LocaisAdmin() {
  const [lista, setLista] = useState<Admin.LocalAdmin[] | null>(null);
  const [cat, setCat] = useState<CategoriaId>('mercado');
  const [ed, setEd] = useState<Edicao | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setLista(await Admin.locais());
    } catch (e) {
      Alert.alert('Erro', (e as Error).message);
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      const t = setTimeout(carregar, 0);
      return () => clearTimeout(t);
    }, [carregar]),
  );

  const daCategoria = (lista ?? []).filter((l) => l.categoria === cat);

  async function alternar(l: Admin.LocalAdmin) {
    try {
      await Admin.salvarLocal({ id: l.id, ativo: !l.ativo });
      carregar();
    } catch (e) {
      Alert.alert('Erro', (e as Error).message);
    }
  }

  async function salvar() {
    if (!ed?.pin) return;
    setOcupado(true);
    try {
      await Admin.salvarLocal({ id: ed.id, categoria: ed.categoria, nome: ed.nome.trim(), endereco: ed.endereco.trim(), lat: ed.pin.lat, lon: ed.pin.lon, cidade: ed.cidade ?? cidadeDe(ed.pin) });
      setCat(ed.categoria);
      setEd(null);
      carregar();
    } catch (e) {
      Alert.alert('Não foi possível salvar', (e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  function apagar(id: string) {
    Alert.alert('Apagar local?', 'Ele some da lista dos clientes. Para só esconder por um tempo, use o interruptor.', [
      { text: 'Voltar', style: 'cancel' },
      {
        text: 'Apagar',
        style: 'destructive',
        onPress: () =>
          Admin.apagarLocal(id)
            .then(() => {
              setEd(null);
              carregar();
            })
            .catch((e) => Alert.alert('Erro', (e as Error).message)),
      },
    ]);
  }

  return (
    <ScrollView contentContainerStyle={s.conteudo} refreshControl={<RefreshControl refreshing={false} onRefresh={carregar} />} keyboardShouldPersistTaps="handled">
      <View style={s.chips}>
        {CATEGORIAS.map((c) => {
          const n = (lista ?? []).filter((l) => l.categoria === c.id && l.ativo).length;
          return (
            <Pressable key={c.id} style={[s.chip, cat === c.id && s.chipAtivo]} onPress={() => setCat(c.id)}>
              <Text style={[s.chipTexto, cat === c.id && { color: cores.primaria }]}>
                {c.icone} {c.nome} ({n})
              </Text>
            </Pressable>
          );
        })}
      </View>

      {!ed && (
        <Pressable style={s.novo} onPress={() => setEd({ categoria: cat, nome: '', endereco: '', pin: null })}>
          <Text style={s.novoTexto}>＋ Cadastrar em {CATEGORIAS.find((c) => c.id === cat)?.nome}</Text>
        </Pressable>
      )}
      {ed && <Formulario ed={ed} setEd={setEd} ocupado={ocupado} onSalvar={salvar} onApagar={ed.id ? () => apagar(ed.id!) : undefined} />}

      {!lista && <ActivityIndicator color={cores.primaria} />}
      {lista && daCategoria.length === 0 && <Text style={s.vazio}>Nenhum local nesta categoria. Os clientes ainda podem digitar outro endereço.</Text>}
      {daCategoria.map((l) => (
        <View key={l.id} style={[s.cartao, !l.ativo && { opacity: 0.55 }]}>
          <View style={{ flex: 1 }}>
            <Text style={s.nome}>{l.nome}</Text>
            <Text style={s.endereco}>
              {l.endereco.split(/, (Guaramirim|Jaraguá do Sul|Schroeder|Massaranduba|Joinville)/)[0]} · {nomeCidade(l.cidade ?? cidadeDe(l))}
            </Text>
            <Pressable onPress={() => setEd({ id: l.id, categoria: l.categoria as CategoriaId, nome: l.nome, endereco: l.endereco, pin: { lat: l.lat, lon: l.lon }, cidade: l.cidade ?? undefined })}>
              <Text style={s.link}>Editar</Text>
            </Pressable>
          </View>
          <Switch value={l.ativo} onValueChange={() => alternar(l)} trackColor={{ true: cores.primaria }} />
        </View>
      ))}
      <Text style={s.dica}>Desligado = escondido dos clientes. Endereços iniciais vieram do OpenStreetMap: confira e ajuste.</Text>
    </ScrollView>
  );
}

function Formulario({ ed, setEd, ocupado, onSalvar, onApagar }: { ed: Edicao; setEd: (e: Edicao | null) => void; ocupado: boolean; onSalvar: () => void; onApagar?: () => void }) {
  const [buscando, setBuscando] = useState(false);
  const cidade: CidadeId = ed.cidade ?? ((ed.pin && cidadeDe(ed.pin)) || 'guaramirim');
  const setCidade = (c: CidadeId) => setEd({ ...ed, cidade: c });
  const centro = CIDADES.find((c) => c.id === cidade)?.centro ?? null;
  const estado: EstadoMapa = useMemo(() => ({ modo: 'escolher', casa: ed.pin, centro, mercados: [] }), [ed.pin, centro]);

  async function achar() {
    setBuscando(true);
    const p = await geocodificar(ed.endereco, cidade).catch(() => null);
    setBuscando(false);
    if (p) setEd({ ...ed, pin: p });
    else Alert.alert('Endereço', 'Não achei. Toque no mapa no ponto certo.');
  }

  const ok = ed.nome.trim().length >= 2 && ed.endereco.trim().length >= 6 && !!ed.pin;
  return (
    <View style={s.form}>
      <Text style={s.formTitulo}>{ed.id ? 'Editar local' : 'Novo local'}</Text>
      <View style={s.chips}>
        {CATEGORIAS.map((c) => (
          <Pressable key={c.id} style={[s.chip, ed.categoria === c.id && s.chipAtivo]} onPress={() => setEd({ ...ed, categoria: c.id })}>
            <Text style={[s.chipTexto, ed.categoria === c.id && { color: cores.primaria }]}>
              {c.icone} {c.nome}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={s.chips}>
        {CIDADES.map((c) => (
          <Pressable key={c.id} style={[s.chip, cidade === c.id && s.chipAtivo]} onPress={() => setCidade(c.id)}>
            <Text style={[s.chipTexto, cidade === c.id && { color: cores.primaria }]}>{c.nome}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput style={s.input} value={ed.nome} onChangeText={(nome) => setEd({ ...ed, nome })} placeholder="Nome (ex.: Distribuidora Gás Bom)" placeholderTextColor={cores.apagado} />
      <TextInput
        style={s.input}
        value={ed.endereco}
        onChangeText={(endereco) => setEd({ ...ed, endereco })}
        placeholder="Rua, número e bairro"
        placeholderTextColor={cores.apagado}
        onSubmitEditing={achar}
      />
      <View style={s.linha}>
        <Text style={s.dica}>{ed.pin ? '✓ Marcado. Toque no mapa para ajustar.' : 'Toque no mapa no ponto exato.'}</Text>
        <Pressable onPress={achar} disabled={buscando || ed.endereco.trim().length < 5}>
          <Text style={s.link}>{buscando ? 'Buscando…' : '🔎 Achar'}</Text>
        </Pressable>
      </View>
      <MapaRuas estado={estado} onEscolher={(pin) => setEd({ ...ed, pin })} style={{ height: 260 }} />
      <View style={s.linha}>
        <Pressable onPress={() => setEd(null)}>
          <Text style={[s.link, { color: cores.suave }]}>Cancelar</Text>
        </Pressable>
        {onApagar && (
          <Pressable onPress={onApagar}>
            <Text style={[s.link, { color: cores.erro }]}>Apagar</Text>
          </Pressable>
        )}
        <Pressable style={[s.salvar, (!ok || ocupado) && { opacity: 0.45 }]} disabled={!ok || ocupado} onPress={onSalvar}>
          {ocupado ? <ActivityIndicator color="#fff" /> : <Text style={s.salvarTexto}>Salvar</Text>}
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  conteudo: { padding: 16, paddingBottom: 40, gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: cores.cartao, borderWidth: 1, borderColor: cores.borda },
  chipAtivo: { backgroundColor: cores.primariaClara, borderColor: cores.primaria },
  chipTexto: { fontSize: 13, fontWeight: '600', color: cores.texto },
  novo: { backgroundColor: cores.primariaClara, borderRadius: raio, paddingVertical: 14, alignItems: 'center' },
  novoTexto: { color: cores.primaria, fontWeight: '700', fontSize: 15 },
  vazio: { color: cores.suave, textAlign: 'center', marginTop: 10 },
  cartao: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: cores.cartao, borderRadius: raio, padding: 14, ...sombra },
  nome: { fontSize: 16, fontWeight: '700', color: cores.texto },
  endereco: { fontSize: 13, color: cores.suave, marginTop: 2 },
  link: { color: cores.primaria, fontWeight: '700', fontSize: 14, paddingVertical: 4 },
  dica: { fontSize: 12, color: cores.suave, flexShrink: 1 },
  form: { backgroundColor: cores.cartao, borderRadius: raio, padding: 14, gap: 10, ...sombra },
  formTitulo: { fontSize: 17, fontWeight: '700', color: cores.texto },
  input: { backgroundColor: cores.fundo, borderRadius: 12, borderWidth: 1, borderColor: cores.borda, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, color: cores.texto },
  linha: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  salvar: { backgroundColor: cores.primaria, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 22 },
  salvarTexto: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
