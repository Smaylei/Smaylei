import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { cores, raio, sombra } from '../components/tema';
import { CATEGORIAS, MODALIDADES, SERVICOS, type CategoriaId, type Liberacao, type ServicoId } from '../data/servicos';
import * as Admin from '../services/admin';

/**
 * Liberação gradual: tudo já está pronto, e cada serviço/categoria só aparece para os clientes
 * quando você ligar aqui. No lançamento, apenas os mercados.
 */
export default function ServicosAdmin() {
  const [lib, setLib] = useState<Liberacao | null>(null);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const c = (await Admin.resumo()).config;
      setLib({ servicosAtivos: c.servicosAtivos, categoriasAtivas: c.categoriasAtivas, outroEnderecoLoja: c.outroEnderecoLoja });
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

  async function salvar(novo: Liberacao) {
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
            <Linha key={sv.id} titulo={`${sv.icone} ${sv.titulo}`} sub={sv.sub} valor={lib.servicosAtivos.includes(sv.id)} onChange={() => alternarServico(sv.id)} bloqueado={salvando} />
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
      <Text style={s.nota}>
        Antes de liberar passageiros, gás ou bebidas, confira as exigências legais, de segurança e seguro de cada modalidade (Documento Conceitual, nota operacional).
      </Text>
    </ScrollView>
  );
}

function Linha({ titulo, sub, valor, onChange, bloqueado }: { titulo: string; sub?: string; valor: boolean; onChange: () => void; bloqueado: boolean }) {
  return (
    <View style={s.linha}>
      <View style={{ flex: 1 }}>
        <Text style={[s.item, !valor && { color: cores.suave }]}>{titulo}</Text>
        {sub ? <Text style={s.sub}>{sub}</Text> : null}
      </View>
      <Text style={[s.estado, { color: valor ? cores.sucesso : cores.apagado }]}>{valor ? 'Liberado' : 'Em breve'}</Text>
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
});
