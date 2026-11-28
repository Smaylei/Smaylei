import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import WebView, { type WebViewMessageEvent } from 'react-native-webview';
import { API } from '../services/api';
import { cores } from './tema';

/** Resultado da autenticação 3DS (Stone): id da transação para o pedido e o status do banco. */
export type Resultado3DS = { transacao: string; status: string };

type Props = {
  visivel: boolean;
  token: string;
  ambiente: 'teste' | 'producao';
  /** Pedido no formato da biblioteca 3ds-nx-js (cliente, cartão, valor e endereço). */
  pedido: object;
  aoConcluir: (r: Resultado3DS) => void;
  aoFalhar: (msg: string) => void;
  aoCancelar: () => void;
};

// Biblioteca 3DS da Stone (a mesma da Pagar.me): conversa com o banco do cliente e, se o banco
// pedir, mostra a confirmação (app do banco, SMS ou senha) dentro desta tela.
const LIB = { teste: 'https://3ds-nx-js.stone.com.br/test/v2/3ds2.min.js', producao: 'https://3ds-nx-js.stone.com.br/live/v2/3ds2.min.js' };
const seguro = (x: unknown) => JSON.stringify(x).replace(/</g, '\\u003c');

function pagina(token: string, ambiente: 'teste' | 'producao', pedido: object) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  html,body{margin:0;height:100%;background:#fff;font-family:-apple-system,Roboto,sans-serif;color:#1a1a1a}
  #msg{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;text-align:center;font-size:16px}
  .roda{width:34px;height:34px;border:4px solid #d6f2e3;border-top-color:#2DB36F;border-radius:50%;animation:g 0.9s linear infinite}
  @keyframes g{to{transform:rotate(360deg)}}
  #metodo{position:absolute;width:1px;height:1px;overflow:hidden;opacity:0}
  #desafio iframe{position:fixed;inset:0;width:100%;height:100%;border:0;background:#fff;z-index:2}
</style>
<script src="${LIB[ambiente]}"></script></head>
<body><div id="msg"><div class="roda"></div><div>Confirmando o débito com o seu banco…</div></div><div id="metodo"></div><div id="desafio"></div>
<script>
  var enviar = function (d) { window.ReactNativeWebView.postMessage(JSON.stringify(d)); };
  window.addEventListener('load', function () {
    if (!window.TDS) return enviar({ tipo: 'erro', msg: 'Não foi possível falar com o seu banco agora.' });
    window.TDS.init({
      token: ${seguro(token)},
      tds_method_container_element: document.getElementById('metodo'),
      challenge_container_element: document.getElementById('desafio'),
      use_default_challenge_iframe_style: false,
      challenge_window_size: '05'
    }, ${seguro(pedido)}).then(function (r) {
      var x = (r && r[0]) || {};
      enviar({ tipo: 'ok', transacao: x.tds_server_trans_id || '', status: x.trans_status || '', cancelado: !!x.challenge_canceled });
    }).catch(function (e) { enviar({ tipo: 'erro', msg: String((e && e.message) || e || '') }); });
  });
</script></body></html>`;
}

/** Confirmação do pagamento no débito com o banco (3DS), em tela cheia por cima do pagamento. */
export default function Autenticacao3DS({ visivel, token, ambiente, pedido, aoConcluir, aoFalhar, aoCancelar }: Props) {
  function mensagem(e: WebViewMessageEvent) {
    let d: { tipo?: string; msg?: string; transacao?: string; status?: string; cancelado?: boolean } = {};
    try {
      d = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    if (d.tipo === 'erro') return aoFalhar(d.msg ? `O banco não confirmou: ${d.msg}` : 'O banco não confirmou o pagamento no débito.');
    if (d.cancelado) return aoCancelar();
    // Y = autenticado; A = tentativa aceita pelo banco. Outros: o banco não confirmou.
    if (d.transacao && (d.status === 'Y' || d.status === 'A')) return aoConcluir({ transacao: d.transacao, status: d.status });
    aoFalhar('O seu banco não confirmou o pagamento no débito. Tente o Pix ou o crédito.');
  }
  return (
    <Modal visible={visivel} animationType="slide" onRequestClose={aoCancelar}>
      <View style={s.topo}>
        <Text style={s.titulo}>Confirmação do banco</Text>
        <Pressable onPress={aoCancelar} hitSlop={10}>
          <Text style={s.cancelar}>Cancelar</Text>
        </Pressable>
      </View>
      {visivel && (
        <WebView
          source={{ html: pagina(token, ambiente, pedido), baseUrl: API }}
          originWhitelist={['*']}
          javaScriptEnabled
          domStorageEnabled
          onMessage={mensagem}
          onError={() => aoFalhar('Sem conexão com o banco. Tente de novo.')}
          style={{ flex: 1, backgroundColor: '#fff' }}
        />
      )}
    </Modal>
  );
}

const s = StyleSheet.create({
  topo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 48, paddingBottom: 14, backgroundColor: cores.fundo },
  titulo: { fontSize: 18, fontWeight: '700', color: cores.texto },
  cancelar: { color: cores.primaria, fontWeight: '700', fontSize: 15 },
});
