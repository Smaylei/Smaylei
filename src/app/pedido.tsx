import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { cores, raio, sombra } from '../components/tema';
import { MERCADOS } from '../data/mercados';
import { useApp } from '../estado/AppContext';
import { api, type CorridaCliente, type Disponibilidade } from '../services/api';
import { formatarReais } from '../services/preco';

export default function PedidoTela() {
  const { modo } = useLocalSearchParams<{ modo?: string }>();
  const agendado = modo === 'agendar';
  const { rotas, valorFrete, recarregarConfig } = useApp();
  const insets = useSafeAreaInsets();
  const [disp, setDisp] = useState<Disponibilidade | null>(null);
  const [mercadoId, setMercadoId] = useState<string | null>(null);
  const [diaIdx, setDiaIdx] = useState(0);
  const [inicio, setInicio] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      recarregarConfig();
      setDisp(await api<Disponibilidade>(null, '/v2/disponibilidade'));
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [recarregarConfig]);

  useEffect(() => {
    const t = setTimeout(carregar, 0);
    return () => clearTimeout(t);
  }, [carregar]);

  const valor = mercadoId ? valorFrete(mercadoId, agendado) : null;
  const dia = disp?.dias[diaIdx];
  const hora = dia?.horarios.find((h) => h.inicio === inicio)?.hora;
  const agoraOk = agendado || (disp?.agora.ok ?? false);
  const pode = !!mercadoId && valor !== null && agoraOk && (!agendado || !!inicio) && !enviando;

  async function chamar() {
    if (!mercadoId) return;
    setEnviando(true);
    setErro(null);
    try {
      const c = await api<CorridaCliente>('cliente', '/v2/corridas', {
        method: 'POST',
        corpo: { mercadoId, agendado, inicio: agendado ? inicio : undefined },
      });
      router.replace(`/checkout/${c.id}`);
    } catch (e) {
      setErro((e as Error).message);
      setInicio(null);
      carregar();
    } finally {
      setEnviando(false);
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: agendado ? 'Agendar frete' : 'Solicitar frete' }} />
      <ScrollView contentContainerStyle={s.conteudo}>
        {!agendado && disp && !disp.agora.ok && (
          <View style={s.aviso}>
            <Text style={s.avisoTitulo}>Indisponível agora</Text>
            <Text style={s.avisoTexto}>{disp.agora.motivo}</Text>
            {disp.dias.length > 0 && (
              <Pressable onPress={() => router.replace({ pathname: '/pedido', params: { modo: 'agendar' } })}>
                <Text style={s.link}>Agendar um horário</Text>
              </Pressable>
            )}
          </View>
        )}

        <Text style={s.secao}>Onde você fez a compra?</Text>
        <View style={{ gap: 8 }}>
          {MERCADOS.map((m) => {
            const v = valorFrete(m.id, agendado);
            const ativo = m.id === mercadoId;
            const semRota = rotas !== null && v === null;
            return (
              <Pressable
                key={m.id}
                disabled={semRota}
                onPress={() => setMercadoId(m.id)}
                style={[s.mercado, ativo && s.mercadoAtivo, semRota && { opacity: 0.4 }]}
                accessibilityRole="radio"
                accessibilityState={{ selected: ativo }}
              >
                <Text style={[s.mercadoNome, ativo && { color: cores.primaria }]}>{m.nome}</Text>
                {rotas === null ? (
                  <ActivityIndicator color={cores.primaria} />
                ) : (
                  <Text style={[s.mercadoValor, ativo && { color: cores.primaria }]}>{v === null ? 'indisponível' : formatarReais(v)}</Text>
                )}
              </Pressable>
            );
          })}
        </View>

        {agendado && (
          <>
            <Text style={s.secao}>Quando?</Text>
            {!disp ? (
              <ActivityIndicator color={cores.primaria} />
            ) : disp.dias.length === 0 ? (
              <Text style={s.avisoTexto}>Sem horários livres no momento.</Text>
            ) : (
              <>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  {disp.dias.map((d, i) => (
                    <Chip
                      key={d.data}
                      texto={d.rotulo}
                      ativo={i === diaIdx}
                      onPress={() => {
                        setDiaIdx(i);
                        setInicio(null);
                      }}
                    />
                  ))}
                </ScrollView>
                <View style={s.faixas}>
                  {dia?.horarios.map((h) => (
                    <Chip key={h.inicio} texto={h.hora} ativo={inicio === h.inicio} onPress={() => setInicio(h.inicio)} />
                  ))}
                </View>
              </>
            )}
          </>
        )}

        <View style={s.info}>
          <Text style={s.infoTexto}>🔒 Pagamento seguro dentro do app (Pix ou cartão). O valor fica retido e só é liberado ao motorista quando você confirmar que ele chegou ao mercado.</Text>
          <Text style={s.infoTexto}>Se nenhum motorista aceitar ou você cancelar antes da chegada, o valor é devolvido.</Text>
        </View>
        {erro && <Text style={s.erro}>{erro}</Text>}
      </ScrollView>

      <View style={[s.rodape, { paddingBottom: 12 + insets.bottom }]}>
        <View style={{ flex: 1 }}>
          <Text style={s.rodapeRotulo}>{agendado && hora ? `${dia?.rotulo} · ${hora}` : 'Valor do frete'}</Text>
          <Text style={s.rodapeValor}>{valor === null ? '—' : formatarReais(valor)}</Text>
        </View>
        <Pressable style={[s.botao, !pode && { opacity: 0.45 }]} disabled={!pode} onPress={chamar}>
          {enviando ? <ActivityIndicator color="#fff" /> : <Text style={s.botaoTexto}>Pagar e {agendado ? 'agendar' : 'chamar'}</Text>}
        </Pressable>
      </View>
    </View>
  );
}

function Chip({ texto, ativo, onPress }: { texto: string; ativo: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[s.chip, ativo && s.chipAtivo]} accessibilityRole="radio" accessibilityState={{ selected: ativo }}>
      <Text style={[s.chipTexto, ativo && { color: '#fff' }]}>{texto}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  conteudo: { padding: 16, paddingBottom: 30 },
  secao: { fontSize: 17, fontWeight: '700', color: cores.texto, marginTop: 12, marginBottom: 10 },
  mercado: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: cores.cartao, ...sombra, borderRadius: raio, borderWidth: 1.5, borderColor: 'transparent', paddingVertical: 16, paddingHorizontal: 16 },
  mercadoAtivo: { borderColor: cores.primaria, borderWidth: 1.5, backgroundColor: cores.primariaClara },
  mercadoNome: { fontSize: 16, fontWeight: '600', color: cores.texto, flexShrink: 1 },
  mercadoValor: { fontSize: 18, fontWeight: '700', color: cores.texto, fontVariant: ['tabular-nums'] },
  faixas: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  chip: { ...sombra, borderRadius: 999, paddingVertical: 9, paddingHorizontal: 14, backgroundColor: cores.cartao },
  chipAtivo: { backgroundColor: cores.primaria, borderColor: cores.primaria },
  chipTexto: { fontSize: 14, fontWeight: '600', color: cores.texto },
  aviso: { marginTop: 8, marginBottom: 4, backgroundColor: cores.alertaFundo, borderRadius: 12, padding: 12, gap: 4 },
  avisoTitulo: { color: cores.alerta, fontSize: 15, fontWeight: '700' },
  avisoTexto: { color: cores.alerta, fontSize: 14 },
  info: { marginTop: 16, gap: 4 },
  infoTexto: { fontSize: 13, color: cores.suave },
  erro: { color: cores.erro, marginTop: 12, fontSize: 14 },
  link: { color: cores.primaria, fontWeight: '700', fontSize: 15, paddingVertical: 6 },
  rodape: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 12, backgroundColor: cores.cartao, borderTopWidth: 1, borderTopColor: cores.borda },
  rodapeRotulo: { fontSize: 13, color: cores.suave },
  rodapeValor: { fontSize: 26, fontWeight: '700', color: cores.primaria, fontVariant: ['tabular-nums'] },
  botao: { backgroundColor: cores.primaria, borderRadius: raio, paddingVertical: 16, paddingHorizontal: 22, alignItems: 'center' },
  botaoTexto: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
