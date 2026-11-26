import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { cores, raio, sombra } from '../components/tema';
import { CIDADES } from '../data/cidades';
import { CATEGORIAS, MODALIDADES, SERVICOS, tarifaMoto, type CategoriaId, type ConfigMoto, type Liberacao, type ServicoId } from '../data/servicos';
import { formatarReais } from '../services/preco';
import * as Admin from '../services/admin';

type Ajustes = Liberacao & ConfigMoto & { deslocamentoPadraoKm: number; deslocamentoMaxKm: number };

/**
 * Liberação gradual: tudo já está pronto, e cada serviço/categoria só aparece para os clientes
 * quando você ligar aqui. No lançamento, apenas os mercados.
 */
export default function ServicosAdmin() {
  const [lib, setLib] = useState<Ajustes | null>(null);
  const [tabela, setTabela] = useState({ minimo: '', incluso: '', porKm: '' });
  const [desloc, setDesloc] = useState('');
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const c = (await Admin.resumo()).config;
      setLib({
        servicosAtivos: c.servicosAtivos, categoriasAtivas: c.categoriasAtivas, outroEnderecoLoja: c.outroEnderecoLoja, cidadesAtivas: c.cidadesAtivas,
        motoAtivo: c.motoAtivo, motoServicos: c.motoServicos, motoMinimo: c.motoMinimo, motoKmIncluso: c.motoKmIncluso, motoPorKm: c.motoPorKm, deslocamentoPadraoKm: c.deslocamentoPadraoKm, deslocamentoMaxKm: c.deslocamentoMaxKm,
      });
      const br = (n: number) => String(n).replace('.', ',');
      setTabela({ minimo: br(c.motoMinimo), incluso: br(c.motoKmIncluso), porKm: br(c.motoPorKm) });
      setDesloc(String(c.deslocamentoPadraoKm).replace('.', ','));
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

  async function salvar(novo: Ajustes) {
    const antes = lib;
    setLib(novo);
    setSalvando(true);
    try {
      await Admin.salvarConfig(novo);
    } catch (e) {
      setLib(antes);
      Alert.alert('Não foi possível salvar', (e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  if (!lib) return <ActivityIndicator style={{ marginTop: 60 }} color={cores.primaria} />;
  const alternarServico = (id: ServicoId) =>
    salvar({ ...lib, servicosAtivos: lib.servicosAtivos.includes(id) ? lib.servicosAtivos.filter((x) => x !== id) : [...lib.servicosAtivos, id] });
  const alternarMoto = (id: ServicoId) =>
    salvar({ ...lib, motoServicos: lib.motoServicos.includes(id) ? lib.motoServicos.filter((x) => x !== id) : [...lib.motoServicos, id] });
  const numero = (t: string) => Number(t.replace(',', '.'));
  const alternarCategoria = (id: CategoriaId) =>
    salvar({ ...lib, categoriasAtivas: lib.categoriasAtivas.includes(id) ? lib.categoriasAtivas.filter((x) => x !== id) : [...lib.categoriasAtivas, id] });

  return (
    <ScrollView contentContainerStyle={s.conteudo}>
      <Text style={s.intro}>Ligue um serviço quando houver demanda: ele aparece na hora no app do cliente. Desligar não afeta pedidos já feitos.</Text>

      {MODALIDADES.map((m) => (
        <View key={m.id} style={s.cartao}>
          <Text style={s.titulo}>
            {m.nome} <Text style={s.desc}>· {m.descricao}</Text>
          </Text>
          {SERVICOS.filter((sv) => sv.modalidade === m.id).map((sv) => (
            <Linha key={sv.id} titulo={`${sv.icone} ${sv.titulo}${sv.publico === 'lojista' ? ' (lojista)' : ''}`} sub={sv.sub} valor={lib.servicosAtivos.includes(sv.id)} onChange={() => alternarServico(sv.id)} bloqueado={salvando} />
          ))}
        </View>
      ))}

      <View style={s.cartao}>
        <Text style={s.titulo}>Categorias de locais</Text>
        <Text style={s.desc}>Quais listas o cliente vê (cadastre os endereços em Locais).</Text>
        {CATEGORIAS.map((c) => (
          <Linha key={c.id} titulo={`${c.icone} ${c.nome}`} valor={lib.categoriasAtivas.includes(c.id)} onChange={() => alternarCategoria(c.id)} bloqueado={salvando} />
        ))}
        <Linha
          titulo="✏️ Outro endereço de loja"
          sub="Permite ao cliente digitar uma loja que não está na lista"
          valor={lib.outroEnderecoLoja}
          onChange={() => salvar({ ...lib, outroEnderecoLoja: !lib.outroEnderecoLoja })}
          bloqueado={salvando}
        />
      </View>
      <View style={s.cartao}>
        <Text style={s.titulo}>Cidades atendidas</Text>
        <Text style={s.desc}>Endereços e locais das cidades desligadas somem do app e são recusados.</Text>
        {CIDADES.map((c) => (
          <Linha
            key={c.id}
            titulo={`📍 ${c.nome}`}
            valor={lib.cidadesAtivas.includes(c.id)}
            onChange={() =>
              lib.cidadesAtivas.includes(c.id) && lib.cidadesAtivas.length === 1
                ? Alert.alert('Cidades', 'Deixe pelo menos uma cidade ligada.')
                : salvar({ ...lib, cidadesAtivas: lib.cidadesAtivas.includes(c.id) ? lib.cidadesAtivas.filter((x) => x !== c.id) : [...lib.cidadesAtivas, c.id] })
            }
            bloqueado={salvando}
          />
        ))}
      </View>
      <View style={s.cartao}>
        <Text style={s.titulo}>🏍️ Moto (motoboy)</Text>
        <Text style={s.desc}>O motorista escolhe carro ou moto no cadastro. Corridas de moto só vão para motos.</Text>
        <Linha titulo="Aceitar pedidos de moto" rotulos={['Ligado', 'Desligado']} valor={lib.motoAtivo} onChange={() => salvar({ ...lib, motoAtivo: !lib.motoAtivo })} bloqueado={salvando} />
        {lib.motoAtivo &&
          SERVICOS.map((sv) => (
            <Linha
              key={sv.id}
              titulo={`${sv.icone} ${sv.titulo}${sv.publico === 'lojista' ? ' (lojista)' : ''}`}
              sub="Pode ser feito de moto"
              rotulos={['Sim', 'Não']}
              valor={lib.motoServicos.includes(sv.id)}
              onChange={() => alternarMoto(sv.id)}
              bloqueado={salvando}
            />
          ))}
        <Text style={[s.item, { marginTop: 10 }]}>Tabela da moto</Text>
        <Text style={s.sub}>Km totais = moto até a coleta + coleta até o destino. Pedido para agora ainda soma a urgência.</Text>
        <View style={s.tabela}>
          {(
            [
              ['minimo', 'Valor mínimo (R$)'],
              ['incluso', 'Km incluídos no mínimo'],
              ['porKm', 'R$ por km excedente'],
            ] as const
          ).map(([k, rotulo]) => (
            <View key={k} style={s.tabelaCampo}>
              <Text style={s.sub}>{rotulo}</Text>
              <TextInput style={s.campoLargo} value={tabela[k]} onChangeText={(t) => setTabela({ ...tabela, [k]: t })} keyboardType="decimal-pad" maxLength={6} />
            </View>
          ))}
          <Pressable
            style={[s.ok, { alignSelf: 'flex-end' }]}
            disabled={salvando}
            onPress={() => {
              const [minimo, incluso, porKm] = [numero(tabela.minimo), numero(tabela.incluso), numero(tabela.porKm)];
              if (!(minimo >= 1 && incluso >= 0 && porKm >= 0)) return Alert.alert('Moto', 'Confira os valores da tabela.');
              salvar({ ...lib, motoMinimo: minimo, motoKmIncluso: incluso, motoPorKm: porKm });
            }}
          >
            <Text style={s.okTexto}>Salvar tabela</Text>
          </Pressable>
        </View>
        <View style={s.exemplos}>
          {[2, 3, 5, 8, 10].map((km) => (
            <View key={km} style={s.exemplo}>
              <Text style={s.sub}>{km === lib.motoKmIncluso ? `até ${km} km` : `${km} km`}</Text>
              <Text style={s.item}>{formatarReais(tarifaMoto(km, lib))}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={s.cartao}>
        <Text style={s.titulo}>Preço: deslocamento até a coleta</Text>
        <Text style={s.desc}>
          O valor = motorista até a coleta + coleta até o destino. Pedido para agora: conta do motorista livre mais perto. Agendado (ainda sem motorista): usa o padrão abaixo.
        </Text>
        <View style={s.campoLinha}>
          <View style={{ flex: 1 }}>
            <Text style={s.item}>Deslocamento padrão (km)</Text>
            <Text style={s.sub}>Máximo cobrado em qualquer pedido: {lib.deslocamentoMaxKm} km.</Text>
          </View>
          <TextInput style={s.campo} value={desloc} onChangeText={setDesloc} keyboardType="decimal-pad" maxLength={4} />
          <Pressable
            style={s.ok}
            disabled={salvando}
            onPress={() =>
              numero(desloc) >= 0 && numero(desloc) <= lib.deslocamentoMaxKm
                ? salvar({ ...lib, deslocamentoPadraoKm: numero(desloc) })
                : Alert.alert('Deslocamento', `Use um valor entre 0 e ${lib.deslocamentoMaxKm} km.`)
            }
          >
            <Text style={s.okTexto}>Salvar</Text>
          </Pressable>
        </View>
      </View>

      <Text style={s.nota}>
        Antes de liberar passageiros, gás ou bebidas, confira as exigências legais, de segurança e seguro de cada modalidade (Documento Conceitual, nota operacional).
      </Text>
    </ScrollView>
  );
}

function Linha({ titulo, sub, valor, onChange, bloqueado, rotulos = ['Liberado', 'Em breve'] }: { titulo: string; sub?: string; valor: boolean; onChange: () => void; bloqueado: boolean; rotulos?: [string, string] }) {
  return (
    <View style={s.linha}>
      <View style={{ flex: 1 }}>
        <Text style={[s.item, !valor && { color: cores.suave }]}>{titulo}</Text>
        {sub ? <Text style={s.sub}>{sub}</Text> : null}
      </View>
      <Text style={[s.estado, { color: valor ? cores.sucesso : cores.apagado }]}>{valor ? rotulos[0] : rotulos[1]}</Text>
      <Switch value={valor} onValueChange={onChange} disabled={bloqueado} trackColor={{ true: cores.primaria }} />
    </View>
  );
}

const s = StyleSheet.create({
  conteudo: { padding: 16, paddingBottom: 40, gap: 12 },
  intro: { fontSize: 14, color: cores.suave, lineHeight: 20 },
  cartao: { backgroundColor: cores.cartao, borderRadius: raio, padding: 14, gap: 4, ...sombra },
  titulo: { fontSize: 15, fontWeight: '800', color: cores.primaria, letterSpacing: 0.5 },
  desc: { fontSize: 13, fontWeight: '500', color: cores.suave, letterSpacing: 0 },
  linha: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderTopWidth: 1, borderTopColor: cores.borda },
  item: { fontSize: 15, fontWeight: '600', color: cores.texto },
  sub: { fontSize: 12, color: cores.suave },
  estado: { fontSize: 11, fontWeight: '700' },
  nota: { fontSize: 12, color: cores.suave, lineHeight: 17 },
  campoLinha: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: cores.borda },
  campo: { width: 72, backgroundColor: cores.fundo, borderRadius: 10, borderWidth: 1, borderColor: cores.borda, paddingHorizontal: 10, paddingVertical: 8, fontSize: 16, color: cores.texto, textAlign: 'center' },
  ok: { backgroundColor: cores.primaria, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 14 },
  tabela: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: 12, paddingVertical: 8 },
  tabelaCampo: { gap: 4, minWidth: 150 },
  campoLargo: { width: 150, backgroundColor: cores.fundo, borderRadius: 10, borderWidth: 1, borderColor: cores.borda, paddingHorizontal: 10, paddingVertical: 8, fontSize: 16, color: cores.texto },
  exemplos: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 6, paddingBottom: 4 },
  exemplo: { backgroundColor: cores.fundo, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, minWidth: 92 },
  okTexto: { color: '#fff', fontWeight: '700' },
});
