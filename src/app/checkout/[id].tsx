import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import WebView, { type WebViewNavigation } from 'react-native-webview';
import { cores } from '../../components/tema';
import { API, api, type CorridaCliente, type Gorjeta } from '../../services/api';
import { formatarReais } from '../../services/preco';

/**
 * Pagamento dentro do app: o checkout seguro da InfinitePay abre embutido nesta tela (sem navegador
 * externo). Quando a InfinitePay manda o cliente de volta, o servidor confirma o pagamento e
 * seguimos para o acompanhamento da corrida. Também usado para a gorjeta (?tipo=gorjeta).
 */
type Cobranca = { titulo: string; valor: number; checkoutUrl: string | null; pendente: boolean };
export default function Checkout() {
  const { id, tipo, corrida } = useLocalSearchParams<{ id: string; tipo?: string; corrida?: string }>();
  const ehGorjeta = tipo === 'gorjeta';
  const [c, setC] = useState<Cobranca | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregandoPagina, setCarregandoPagina] = useState(true);
  const [confirmando, setConfirmando] = useState(false);
  const saiu = useRef(false);

  const conferir = useCallback(async () => {
    try {
      let atual: Cobranca;
      if (ehGorjeta) {
        const g = await api<Gorjeta>('cliente', `/v2/gorjetas/${id}`);
        atual = { titulo: 'Gorjeta para o motorista', valor: g.valor, checkoutUrl: g.status === 'pendente' ? g.checkoutUrl : null, pendente: g.status === 'pendente' };
      } else {
        const cc = await api<CorridaCliente>('cliente', `/v2/corridas/${id}`);
        atual = {
          titulo: cc.pacote ? `${cc.servicoTitulo} · ${cc.pacote.viagens} viagens` : (cc.servicoTitulo ?? cc.mercadoNome),
          valor: cc.pacote?.valor ?? cc.valor,
          checkoutUrl: cc.checkoutUrl,
          pendente: cc.status === 'pagamento_pendente',
        };
      }
      setC(atual);
      if (!atual.pendente && !saiu.current) {
        saiu.current = true;
        if (ehGorjeta) router.back();
        else router.replace(`/corrida/${id}`);
      }
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [id, ehGorjeta]);

  useFocusEffect(
    useCallback(() => {
      const t0 = setTimeout(conferir, 0);
      const t = setInterval(conferir, 4000); // o aviso da InfinitePay (webhook) também confirma
      return () => {
        clearTimeout(t0);
        clearInterval(t);
      };
    }, [conferir]),
  );

  function navegacao(req: WebViewNavigation | { url: string }) {
    const url = req.url;
    if (API && url.startsWith(`${API}/retorno`)) {
      // Voltou da InfinitePay: o servidor confere o pagamento ao carregar essa página.
      setConfirmando(true);
      setTimeout(conferir, 1200);
      return true;
    }
    if (/^(mercadofrete|intent|market):/i.test(url)) return false;
    // Links de banco/Pix (outros apps) abrem fora; o resto continua aqui dentro.
    if (!/^https?:/i.test(url)) {
      Linking.openURL(url).catch(() => {});
      return false;
    }
    return true;
  }

  if (!c) return erro ? <Text style={[s.erro, { padding: 20 }]}>{erro}</Text> : <ActivityIndicator style={{ marginTop: 60 }} color={cores.primaria} />;

  return (
    <View style={{ flex: 1, backgroundColor: cores.fundo }}>
      <Stack.Screen options={{ title: ehGorjeta ? 'Gorjeta' : 'Pagamento seguro' }} />
      <View style={s.topo}>
        <Text style={s.cadeado}>🔒</Text>
        <View style={{ flex: 1 }}>
          <Text style={s.topoTitulo}>
            {c.titulo} · {formatarReais(c.valor)}
          </Text>
          <Text style={s.topoSub}>
            {ehGorjeta
              ? 'Pix ou cartão à vista, pela InfinitePay. 100% vai para o motorista.'
              : 'Pix ou cartão à vista, pela InfinitePay. O valor fica retido e só é liberado ao motorista quando você confirmar.'}
          </Text>
        </View>
      </View>
      {c.checkoutUrl ? (
        <WebView
          source={{ uri: c.checkoutUrl }}
          onShouldStartLoadWithRequest={navegacao}
          onNavigationStateChange={(n) => {
            if (API && n.url.startsWith(`${API}/retorno`)) navegacao(n);
          }}
          onLoadEnd={() => setCarregandoPagina(false)}
          originWhitelist={['https://*', 'http://*']}
          javaScriptEnabled
          domStorageEnabled
          setSupportMultipleWindows={false}
          style={{ flex: 1 }}
        />
      ) : (
        <Text style={s.erro}>{ehGorjeta ? 'Este link de gorjeta expirou. Volte e tente de novo.' : 'Este pagamento expirou. Faça o pedido de novo.'}</Text>
      )}
      {(carregandoPagina || confirmando) && (
        <View style={s.sobre}>
          <ActivityIndicator color={cores.primaria} size="large" />
          <Text style={s.sobreTexto}>{confirmando ? 'Confirmando o pagamento…' : 'Abrindo o pagamento seguro…'}</Text>
        </View>
      )}
      <Pressable
        style={s.cancelar}
        onPress={() =>
          ehGorjeta
            ? router.canGoBack()
              ? router.back()
              : router.replace(corrida ? `/corrida/${corrida}` : '/')
            : api('cliente', `/v2/corridas/${id}/cancelar`, { method: 'POST' })
                .catch(() => {})
                .finally(() => router.replace('/'))
        }
      >
        <Text style={[s.cancelarTexto, ehGorjeta && { color: cores.suave }]}>{ehGorjeta ? 'Agora não' : 'Desistir do pedido'}</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  topo: { flexDirection: 'row', gap: 12, alignItems: 'center', padding: 14, backgroundColor: cores.primariaClara },
  cadeado: { fontSize: 24 },
  topoTitulo: { fontSize: 15, fontWeight: '700', color: cores.texto },
  topoSub: { fontSize: 12, color: cores.suave },
  sobre: { position: 'absolute', top: 70, left: 0, right: 0, bottom: 50, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(246,247,245,0.94)', gap: 10 },
  sobreTexto: { color: cores.texto, fontSize: 15 },
  erro: { color: cores.erro, fontSize: 14, padding: 16 },
  cancelar: { padding: 14, alignItems: 'center', borderTopWidth: 1, borderTopColor: cores.borda, backgroundColor: cores.cartao },
  cancelarTexto: { color: cores.erro, fontWeight: '700' },
});
