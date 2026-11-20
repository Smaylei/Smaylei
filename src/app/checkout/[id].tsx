import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import WebView, { type WebViewNavigation } from 'react-native-webview';
import { cores } from '../../components/tema';
import { API, api, type CorridaCliente } from '../../services/api';
import { formatarReais } from '../../services/preco';

/**
 * Pagamento dentro do app: o checkout seguro da InfinitePay abre embutido nesta tela (sem navegador
 * externo). Quando a InfinitePay manda o cliente de volta, o servidor confirma o pagamento e
 * seguimos para o acompanhamento da corrida.
 */
export default function Checkout() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [c, setC] = useState<CorridaCliente | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregandoPagina, setCarregandoPagina] = useState(true);
  const [confirmando, setConfirmando] = useState(false);
  const saiu = useRef(false);

  const conferir = useCallback(async () => {
    try {
      const atual = await api<CorridaCliente>('cliente', `/v2/corridas/${id}`);
      setC(atual);
      if (atual.status !== 'pagamento_pendente' && !saiu.current) {
        saiu.current = true;
        router.replace(`/corrida/${id}`);
      }
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [id]);

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
      <Stack.Screen options={{ title: 'Pagamento seguro' }} />
      <View style={s.topo}>
        <Text style={s.cadeado}>🔒</Text>
        <View style={{ flex: 1 }}>
          <Text style={s.topoTitulo}>
            {c.mercadoNome} · {formatarReais(c.valor)}
          </Text>
          <Text style={s.topoSub}>Processado pela InfinitePay. O valor fica retido até você confirmar que o motorista chegou.</Text>
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
        <Text style={s.erro}>Este pagamento expirou. Faça o pedido de novo.</Text>
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
          api('cliente', `/v2/corridas/${id}/cancelar`, { method: 'POST' })
            .catch(() => {})
            .finally(() => router.replace('/'))
        }
      >
        <Text style={s.cancelarTexto}>Desistir do pedido</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  topo: { flexDirection: 'row', gap: 10, alignItems: 'center', padding: 12, backgroundColor: cores.primariaClara, borderBottomWidth: 1, borderBottomColor: cores.borda },
  cadeado: { fontSize: 24 },
  topoTitulo: { fontSize: 15, fontWeight: '800', color: cores.texto },
  topoSub: { fontSize: 12, color: cores.suave },
  sobre: { position: 'absolute', top: 70, left: 0, right: 0, bottom: 50, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(242,245,243,0.92)', gap: 10 },
  sobreTexto: { color: cores.texto, fontSize: 15 },
  erro: { color: cores.erro, fontSize: 14, padding: 16 },
  cancelar: { padding: 14, alignItems: 'center', borderTopWidth: 1, borderTopColor: cores.borda, backgroundColor: cores.cartao },
  cancelarTexto: { color: cores.erro, fontWeight: '700' },
});
