import { Redirect, router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BotaoInicio, MarcaTopo } from '../components/Marca';
import MinhaConta from '../components/MinhaConta';
import { cores, raio, sombra } from '../components/tema';
import { MODALIDADES, servicosLiberados } from '../data/servicos';
import { useApp } from '../estado/AppContext';
import { api, ROTULO_STATUS, type CorridaCliente } from '../services/api';
import * as D from '../services/delivery';
import { formatarReais } from '../services/preco';

/** Início do lojista: chamar motorista para as compras (e o cliente) e acompanhar os pedidos da loja. */
export default function Lojista() {
  const { carregado, casa, temConta, eu, config, recarregarEu } = useApp();
  const [ativas, setAtivas] = useState<CorridaCliente[]>([]);
  const [vitrine, setVitrine] = useState<D.MinhaVitrine | null>(null);

  const carregar = useCallback(() => {
    recarregarEu();
    api<CorridaCliente[]>('lojista', '/v2/corridas/ativas').then(setAtivas).catch(() => {});
    D.minhaVitrine().then(setVitrine).catch(() => {});
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
  if (!temConta) return <Redirect href="/entrar" />;
  if (!casa) return <ActivityIndicator style={{ marginTop: 60 }} color={cores.primaria} />;
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

      {vitrine && (
        <Pressable style={[s.vitrine, vitrine.pedidosNovos > 0 && s.vitrineNova]} onPress={() => router.push(vitrine.pedidosNovos > 0 ? '/pedidos-loja' : '/vitrine')}>
          <View style={s.icone}>
            <Text style={{ fontSize: 24 }}>🛵</Text>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={s.servicoTitulo}>{vitrine.pedidosNovos > 0 ? `🔔 ${vitrine.pedidosNovos} ${vitrine.pedidosNovos === 1 ? 'pedido novo' : 'pedidos novos'}` : 'Minha vitrine · Delivery'}</Text>
            <Text style={s.servicoSub}>
              {!vitrine.ativa
                ? `Venda seus produtos pelo app: ${formatarReais(vitrine.mensalidade)} por mês, sem taxa por pedido.`
                : `${vitrine.aberta ? 'Aberta' : 'Fechada'} · ${vitrine.produtosAtivos} produtos · ${formatarReais(vitrine.saldo.disponivel)} a receber`}
            </Text>
          </View>
        </Pressable>
      )}
      {vitrine && config.gateway === 'pagarme' && !vitrine.recebedor?.ativo && (
        <Pressable style={s.aviso} onPress={() => router.push('/conta-recebimento')}>
          <Text style={s.avisoTitulo}>{vitrine.recebedor?.temConta ? '🏦 Falta a prova de vida' : '🏦 Cadastre a conta para receber'}</Text>
          <Text style={s.avisoTexto}>
            {vitrine.recebedor?.temConta
              ? 'Toque para fazer a selfie da Pagar.me e começar a receber as vendas direto na conta da loja.'
              : 'As vendas do delivery caem direto na conta da loja. Leva uns 3 minutos.'}
          </Text>
        </Pressable>
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
      <MinhaConta temSenha={eu?.temSenha ?? true} onSenhaCriada={recarregarEu} />
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
  vitrine: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: cores.cartao, borderRadius: raio + 2, padding: 16, borderWidth: 1.5, borderColor: cores.primariaMedia },
  vitrineNova: { backgroundColor: cores.primariaClara, borderColor: cores.primaria },
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
