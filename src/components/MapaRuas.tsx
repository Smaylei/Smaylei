import { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import WebView, { type WebViewMessageEvent } from 'react-native-webview';
import { htmlMapa } from './mapaHtml';
import { cores } from './tema';

export type EstadoMapa = {
  modo: 'escolher' | 'rota' | 'frota';
  /** Painel Admin: todos os motoristas (livre, em corrida, offline). */
  motoristas?: { id: string; nome: string; lat: number; lon: number; moto?: boolean; estado: 'livre' | 'corrida' | 'offline' }[];
  /** Painel Admin: centraliza neste ponto (motorista escolhido na lista). */
  foco?: { lat: number; lon: number } | null;
  casa: { lat: number; lon: number } | null;
  mercados: { id: string; curto: string; lat: number; lon: number }[];
  sel?: string | null;
  rota?: { ida: [number, number][]; volta: [number, number][] } | null;
  rua?: string | null; // (mapa antigo) ignorado
  motorista?: { lat: number; lon: number; moto?: boolean } | null; // posição ao vivo do motorista (🏍️ se moto)
  /** Centro inicial (ex.: a cidade escolhida) quando ainda não há ponto marcado. */
  centro?: { lat: number; lon: number } | null;
};

type Props = {
  estado: EstadoMapa;
  onEscolher?: (p: { lat: number; lon: number }) => void;
  onMotorista?: (id: string) => void;
  style?: ViewStyle;
};

let htmlCache: string | null = null;

/** Mapa OpenStreetMap (MapLibre + OpenFreeMap) dentro de uma WebView: sem Google e sem chave de API. */
export default function MapaRuas({ estado, onEscolher, onMotorista, style }: Props) {
  const ref = useRef<{ injectJavaScript: (js: string) => void } | null>(null);
  const pronto = useRef(false);
  const fonte = useMemo(() => ({ html: (htmlCache ??= htmlMapa()), baseUrl: 'https://movi.app/' }), []);
  const json = JSON.stringify(estado);

  useEffect(() => {
    if (pronto.current) ref.current?.injectJavaScript(`window.mfEstado(${json});true;`);
  }, [json]);

  function aoReceber(e: WebViewMessageEvent) {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.tipo === 'pronto') {
        pronto.current = true;
        ref.current?.injectJavaScript(`window.mfEstado(${json});true;`);
      } else if (msg.tipo === 'pin') onEscolher?.({ lat: msg.lat, lon: msg.lon });
      else if (msg.tipo === 'motorista') onMotorista?.(msg.id);
    } catch {
      // mensagem desconhecida
    }
  }

  return (
    <View style={[s.caixa, style]}>
      <WebView
        ref={ref as never}
        source={fonte}
        originWhitelist={['*']}
        onMessage={aoReceber}
        scrollEnabled={false}
        bounces={false}
        javaScriptEnabled
        domStorageEnabled
        style={s.web}
      />
    </View>
  );
}

const s = StyleSheet.create({
  caixa: { height: 320, borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: cores.borda },
  web: { flex: 1, backgroundColor: cores.fundo },
});
