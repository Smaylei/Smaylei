import { Redirect, router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { cores, raio } from '../components/tema';
import { useApp } from '../estado/AppContext';
import { api, ROTULO_STATUS, type CorridaCliente } from '../services/api';
import { formatarReais } from '../services/preco';
import { VARIANTE } from '../variante';

export default function Inicio() {
  const { carregado, casa, temConta } = useApp();
  const [ativas, setAtivas] = useState<CorridaCliente[]>([]);
  const [taxa, setTaxa] = useState(0);

  useFocusEffect(
    useCallback(() => {
      if (VARIANTE !== 'cliente' || !temConta) return;
      const carregar = () => {
        api<CorridaCliente[]>('cliente', '/v2/corridas/ativas').then(setAtivas).catch(() => {});
        api<{ taxaPendente: number }>('cliente', '/v2/eu')
          .then((e) => setTaxa(e.taxaPendente))
          .catch(() => {});
      };
      const t0 = setTimeout(carregar, 0);
      const t = setInterval(carregar, 10_000);
      return () => {
        clearTimeout(t0);
        clearInterval(t);
      };
    }, [temConta]),
  );

  if (VARIANTE === 'admin') return <Redirect href="/painel" />;
  if (VARIANTE === 'motorista') return <Redirect href="/motorista" />;
  if (!carregado) return <ActivityIndicator style={{ marginTop: 60 }} color={cores.primaria} />;
  if (!casa || !temConta) return <Redirect href="/cadastro" />;

  return (
    <ScrollView contentContainerStyle={s.conteudo}>
      <Text style={s.ola}>Olá{casa.nome ? `, ${casa.nome.split(' ')[0]}` : ''}!</Text>
      <Text style={s.sub}>Suas compras do mercado entregues em casa.</Text>

      {ativas.map((c) => (
        <Pressable
          key={c.id}
          style={[s.status, c.status === 'cancelado' ? s.statusCancelado : c.status === 'aguardando_pagamento' ? s.statusPagar : s.statusOk]}
          onPress={() => router.push(`/corrida/${c.id}`)}
        >
          <Text style={[s.statusTitulo, { color: c.status === 'cancelado' ? cores.erro : c.status === 'aguardando_pagamento' ? cores.alerta : cores.primaria }]}>
            {c.status === 'aguardando_pagamento' ? '💳 Pague agora: motorista no mercado' : ROTULO_STATUS[c.status]}
          </Text>
          <Text style={s.statusTexto}>
            {c.mercadoNome} · {c.agendado ? c.janela : 'agora'} · {formatarReais(c.valorCobrado)}
          </Text>
          <Text style={s.verMais}>Acompanhar ›</Text>
        </Pressable>
      ))}

      {taxa > 0 && <Text style={s.taxa}>Você tem uma taxa de deslocamento de {formatarReais(taxa)}, cobrada junto do próximo frete.</Text>}

      <Pressable style={[s.acao, s.acaoPrincipal]} onPress={() => router.push({ pathname: '/pedido', params: { modo: 'agora' } })}>
        <Text style={s.acaoIcone}>⚡</Text>
        <View style={{ flex: 1 }}>
          <Text style={[s.acaoTitulo, { color: '#fff' }]}>Solicitar frete</Text>
          <Text style={[s.acaoSub, { color: '#D7F0E1' }]}>Um motorista busca suas compras agora</Text>
        </View>
      </Pressable>

      <Pressable style={s.acao} onPress={() => router.push({ pathname: '/pedido', params: { modo: 'agendar' } })}>
        <Text style={s.acaoIcone}>📅</Text>
        <View style={{ flex: 1 }}>
          <Text style={s.acaoTitulo}>Agendar frete</Text>
          <Text style={s.acaoSub}>Escolha o dia e o horário</Text>
        </View>
      </Pressable>

      <View style={s.endereco}>
        <View style={{ flex: 1 }}>
          <Text style={s.rotulo}>Entregar em</Text>
          <Text style={s.enderecoTexto}>{casa.endereco}</Text>
        </View>
        <Pressable onPress={() => router.push('/cadastro')} hitSlop={10}>
          <Text style={s.alterar}>Alterar</Text>
        </Pressable>
      </View>
      <Text style={s.comoFunciona}>
        Como funciona: você pede, um motorista aceita e vai ao mercado. Quando ele chegar, você paga o frete pelo app (Pix ou cartão) e acompanha a entrega em tempo real.
      </Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  conteudo: { padding: 20, gap: 14 },
  ola: { fontSize: 26, fontWeight: '800', color: cores.texto, marginTop: 8 },
  sub: { fontSize: 15, color: cores.suave, marginBottom: 4 },
  acao: { flexDirection: 'row', alignItems: 'center', gap: 16, backgroundColor: cores.cartao, borderRadius: raio + 4, borderWidth: 1, borderColor: cores.borda, paddingVertical: 24, paddingHorizontal: 20 },
  acaoPrincipal: { backgroundColor: cores.primaria, borderColor: cores.primaria },
  acaoIcone: { fontSize: 32 },
  acaoTitulo: { fontSize: 21, fontWeight: '800', color: cores.texto },
  acaoSub: { fontSize: 14, color: cores.suave, marginTop: 2 },
  status: { borderRadius: raio, padding: 14, borderWidth: 1 },
  statusOk: { backgroundColor: cores.primariaClara, borderColor: cores.primaria },
  statusPagar: { backgroundColor: cores.alertaFundo, borderColor: cores.alerta },
  statusCancelado: { backgroundColor: cores.cartao, borderColor: cores.borda },
  statusTitulo: { fontSize: 16, fontWeight: '800' },
  statusTexto: { fontSize: 14, color: cores.texto, marginTop: 2 },
  verMais: { fontSize: 13, color: cores.primaria, fontWeight: '700', marginTop: 6 },
  taxa: { fontSize: 13, color: cores.alerta, backgroundColor: cores.alertaFundo, padding: 10, borderRadius: 10 },
  endereco: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6, padding: 14, borderRadius: raio, backgroundColor: cores.primariaClara },
  rotulo: { fontSize: 12, fontWeight: '700', color: cores.primaria, textTransform: 'uppercase', letterSpacing: 0.5 },
  enderecoTexto: { fontSize: 15, color: cores.texto, marginTop: 2 },
  alterar: { color: cores.primaria, fontWeight: '700', fontSize: 15 },
  comoFunciona: { fontSize: 12, color: cores.suave, marginTop: 4 },
});
