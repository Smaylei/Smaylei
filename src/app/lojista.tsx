import { Redirect, router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BotaoInicio, MarcaTopo } from '../components/Marca';
import { cores, raio, sombra } from '../components/tema';
import { MODALIDADES, servicosLiberados } from '../data/servicos';
import { useApp } from '../estado/AppContext';
import { api, ROTULO_STATUS, type CorridaCliente } from '../services/api';
import { formatarReais } from '../services/preco';

/** Início do lojista: chamar motorista para as compras (e o cliente) e acompanhar os pedidos da loja. */
export default function Lojista() {
  const { carregado, casa, temConta, eu, config, recarregarEu } = useApp();
  const [ativas, setAtivas] = useState<CorridaCliente[]>([]);

  const carregar = useCallback(() => {
    recarregarEu();
    api<CorridaCliente[]>('lojista', '/v2/corridas/ativas').then(setAtivas).catch(() => {});
  }, [recarregarEu]);

  useFocusEffect(
    useCallback(() => {
      if (!temConta) return;
      const t0 = setTimeout(carregar, 0);
      const t = setInterval(carregar, 10_000);
      return () => {
        clearTimeout(t0);
        clearInterval(t);
      };
    }, [temConta, carregar]),
  );

  if (!carregado) return <ActivityIndicator style={{ marginTop: 60 }} color={cores.primaria} />;
  if (!temConta || !casa) return <Redirect href="/cadastro-lojista" />;
  const aprovada = eu?.status === 'aprovado';

  return (
    <ScrollView contentContainerStyle={s.conteudo} refreshControl={<RefreshControl refreshing={false} onRefresh={carregar} tintColor={cores.primaria} />}>
      <Stack.Screen options={{ headerTitle: () => <MarcaTopo />, headerLeft: () => <BotaoInicio /> }} />
      <Text style={s.ola}>{eu?.lojaNome ?? casa.nome}</Text>
      <Text style={s.sub}>Chame um motorista para as compras do seu cliente.</Text>

      {eu && !aprovada && (
        <View style={s.aviso}>
          <Text style={s.avisoTitulo}>{eu.status === 'bloqueado' ? '⛔ Loja bloqueada' : '⏳ Cadastro em análise'}</Text>
          <Text style={s.avisoTexto}>
            {eu.status === 'bloqueado' ? 'Fale com o suporte da MOVI.' : 'A MOVI vai conferir os dados da loja. Assim que for aprovada, você já pode chamar motoristas.'}
          </Text>
        </View>
      )}

      {ativas.map((c) => (
        <Pressable key={c.id} style={[s.status, c.status === 'no_local' ? s.statusAtencao : s.statusOk]} onPress={() => router.push(`/corrida/${c.id}`)}>
          <Text style={[s.statusTitulo, { color: c.status === 'no_local' ? cores.alerta : cores.primaria }]}>
            {c.status === 'no_local' ? '👋 Confirme que o motorista chegou à loja' : ROTULO_STATUS[c.status]}
          </Text>
          <Text style={s.statusTexto}>
            {c.servicoTitulo} → {c.entrega?.nome}
          </Text>
          <Text style={s.statusTexto}>
            {c.agendado ? c.janela : 'Agora'} · {formatarReais(c.valor)}
          </Text>
        </Pressable>
      ))}

      {MODALIDADES.map((m) => {
        const lista = servicosLiberados(config, 'lojista').filter((sv) => sv.modalidade === m.id);
        if (!lista.length) return null;
        return (
          <View key={m.id} style={{ gap: 8 }}>
            <Text style={s.modalidade}>{m.nome}</Text>
            {lista.map((sv) => (
              <Pressable
                key={sv.id}
                style={[s.servico, !aprovada && { opacity: 0.5 }]}
                disabled={!aprovada}
                onPress={() => router.push({ pathname: '/pedido', params: { servico: sv.id } })}
              >
                <View style={s.icone}>
                  <Text style={{ fontSize: 24 }}>{sv.icone}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.servicoTitulo}>{sv.titulo}</Text>
                  <Text style={s.servicoSub}>{sv.sub}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        );
      })}

      <View style={s.endereco}>
        <View style={{ flex: 1 }}>
          <Text style={s.rotulo}>Endereço da loja</Text>
          <Text style={s.enderecoTexto}>{casa.endereco}</Text>
        </View>
        <Pressable onPress={() => router.push('/cadastro-lojista')} hitSlop={10}>
          <Text style={s.alterar}>Alterar</Text>
        </Pressable>
      </View>
      <Text style={s.como}>
        Você paga a corrida pelo app (Pix ou cartão à vista). O valor fica retido e só é liberado ao motorista quando você confirmar que ele chegou à loja.
      </Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  conteudo: { padding: 20, gap: 14 },
  ola: { fontSize: 24, fontWeight: '700', color: cores.texto, marginTop: 4 },
  sub: { fontSize: 15, color: cores.suave },
  aviso: { backgroundColor: cores.alertaFundo, borderRadius: raio, padding: 16, gap: 4 },
  avisoTitulo: { color: cores.alerta, fontSize: 16, fontWeight: '700' },
  avisoTexto: { color: cores.texto, fontSize: 14, lineHeight: 20 },
  status: { borderRadius: raio, padding: 16, gap: 2 },
  statusOk: { backgroundColor: cores.primariaClara },
  statusAtencao: { backgroundColor: cores.alertaFundo },
  statusTitulo: { fontSize: 16, fontWeight: '700' },
  statusTexto: { fontSize: 14, color: cores.texto },
  modalidade: { fontSize: 13, fontWeight: '800', color: cores.primaria, letterSpacing: 1, marginTop: 6 },
  servico: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: cores.cartao, borderRadius: raio + 2, padding: 16, ...sombra },
  icone: { width: 52, height: 52, borderRadius: 26, backgroundColor: cores.primariaClara, alignItems: 'center', justifyContent: 'center' },
  servicoTitulo: { fontSize: 18, fontWeight: '700', color: cores.texto },
  servicoSub: { fontSize: 13, color: cores.suave, lineHeight: 18 },
  endereco: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: raio, backgroundColor: cores.cartao, ...sombra },
  rotulo: { fontSize: 12, fontWeight: '700', color: cores.primaria, textTransform: 'uppercase', letterSpacing: 0.5 },
  enderecoTexto: { fontSize: 15, color: cores.texto, marginTop: 2 },
  alterar: { color: cores.primaria, fontWeight: '700', fontSize: 15 },
  como: { fontSize: 12, color: cores.suave, lineHeight: 18 },
});
