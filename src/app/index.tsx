import { Redirect, router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { cores, raio, sombra } from '../components/tema';
import { SERVICOS } from '../data/servicos';
import { useApp } from '../estado/AppContext';
import { api, ROTULO_STATUS, type CorridaCliente } from '../services/api';
import { formatarReais } from '../services/preco';
import { VARIANTE } from '../variante';

export default function Inicio() {
  const { carregado, casa, temConta } = useApp();
  const [ativas, setAtivas] = useState<CorridaCliente[]>([]);

  useFocusEffect(
    useCallback(() => {
      if (VARIANTE !== 'cliente' || !temConta) return;
      const carregar = () => {
        api<CorridaCliente[]>('cliente', '/v2/corridas/ativas').then(setAtivas).catch(() => {});
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
      <Text style={s.sub}>Do que você precisa hoje?</Text>

      {ativas
        .filter((c) => !(c.status === 'entregue' && c.avaliacao != null))
        .map((c) => {
          const avaliar = c.status === 'entregue';
          const receber = c.status === 'em_andamento' && !c.clienteNaColeta && !!c.chegouDestinoEm;
          const atencao = (c.status === 'no_local' && c.clienteNaColeta) || avaliar || receber;
          const titulo = receber
            ? '📦 Chegou! Confirme o recebimento'
            : c.status === 'no_local' && c.clienteNaColeta
              ? '👋 Confirme que o motorista chegou'
              : avaliar
                ? '⭐ Entregue! Avalie o serviço'
                : ROTULO_STATUS[c.status];
          return (
            <Pressable
              key={c.id}
              style={[s.status, c.status === 'cancelado' ? s.statusCancelado : atencao ? s.statusAtencao : s.statusOk]}
              onPress={() => router.push(`/corrida/${c.id}`)}
            >
              <Text style={[s.statusTitulo, { color: c.status === 'cancelado' ? cores.erro : atencao ? cores.alerta : cores.primaria }]}>{titulo}</Text>
              <Text style={s.statusTexto}>
                {c.servicoTitulo ?? 'Frete'} · {c.coleta?.nome ?? c.mercadoNome} → {c.entrega?.nome ?? 'Casa'}
              </Text>
              <Text style={s.statusTexto}>
                {c.agendado ? c.janela : 'Agora'} · {formatarReais(c.valor)}
              </Text>
              <Text style={s.verMais}>{avaliar ? 'Avaliar ›' : 'Acompanhar ›'}</Text>
            </Pressable>
          );
        })}

      <View style={s.grade}>
        {SERVICOS.map((sv, i) => (
          <Pressable
            key={sv.id}
            style={[s.servico, i === 0 && s.servicoPrincipal]}
            onPress={() => router.push({ pathname: '/pedido', params: { servico: sv.id } })}
            accessibilityRole="button"
          >
            <View style={[s.icone, i === 0 && { backgroundColor: 'rgba(255,255,255,0.18)' }]}>
              <Text style={s.iconeTexto}>{sv.icone}</Text>
            </View>
            <Text style={[s.servicoTitulo, i === 0 && { color: '#fff' }]}>{sv.titulo}</Text>
            <Text style={[s.servicoSub, i === 0 && { color: cores.sobrePrimaria }]} numberOfLines={3}>
              {sv.sub}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={s.endereco}>
        <View style={{ flex: 1 }}>
          <Text style={s.rotulo}>Minha casa</Text>
          <Text style={s.enderecoTexto}>{casa.endereco}</Text>
        </View>
        <Pressable onPress={() => router.push('/cadastro')} hitSlop={10}>
          <Text style={s.alterar}>Alterar</Text>
        </Pressable>
      </View>
      <Text style={s.comoFunciona}>
        Mercados, padarias, farmácias, gás e bebidas, oficinas e borracharias de Guaramirim. Você paga pelo app (Pix ou cartão à vista); o valor fica retido até o
        motorista chegar e você confirmar. Acompanhe o carro em tempo real.
      </Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  conteudo: { padding: 20, gap: 14 },
  ola: { fontSize: 26, fontWeight: '700', color: cores.texto, marginTop: 8 },
  sub: { fontSize: 15, color: cores.suave, marginBottom: 4 },
  grade: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  servico: { width: '47%', flexGrow: 1, backgroundColor: cores.cartao, borderRadius: raio + 2, padding: 16, gap: 6, ...sombra },
  servicoPrincipal: { backgroundColor: cores.primaria },
  icone: { width: 48, height: 48, borderRadius: 24, backgroundColor: cores.primariaClara, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  iconeTexto: { fontSize: 24 },
  servicoTitulo: { fontSize: 16, fontWeight: '700', color: cores.texto },
  servicoSub: { fontSize: 12, color: cores.suave, lineHeight: 16 },
  status: { borderRadius: raio, padding: 16, gap: 2 },
  statusOk: { backgroundColor: cores.primariaClara },
  statusAtencao: { backgroundColor: cores.alertaFundo },
  statusCancelado: { backgroundColor: cores.cartao, ...sombra },
  statusTitulo: { fontSize: 16, fontWeight: '700' },
  statusTexto: { fontSize: 14, color: cores.texto },
  verMais: { fontSize: 13, color: cores.primaria, fontWeight: '700', marginTop: 6 },
  endereco: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6, padding: 16, borderRadius: raio, backgroundColor: cores.cartao, ...sombra },
  rotulo: { fontSize: 12, fontWeight: '700', color: cores.primaria, textTransform: 'uppercase', letterSpacing: 0.5 },
  enderecoTexto: { fontSize: 15, color: cores.texto, marginTop: 2 },
  alterar: { color: cores.primaria, fontWeight: '700', fontSize: 15 },
  comoFunciona: { fontSize: 12, color: cores.suave, marginTop: 4, lineHeight: 18 },
});
