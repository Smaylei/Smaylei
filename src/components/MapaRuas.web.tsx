import { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import type { EstadoMapa } from './MapaRuas';
import { htmlMapa } from './mapaHtml';
import { cores } from './tema';

export type { EstadoMapa } from './MapaRuas';

type Props = { estado: EstadoMapa; onEscolher?: (p: { lat: number; lon: number }) => void; onMotorista?: (id: string) => void; style?: object };

/** Versão navegador (painel Admin web): o mesmo mapa num iframe. */
export default function MapaRuas({ estado, onEscolher, onMotorista, style }: Props) {
  const ref = useRef<HTMLIFrameElement | null>(null);
  const pronto = useRef(false);
  const html = useMemo(() => htmlMapa(), []);
  const json = JSON.stringify(estado);
  const ultimo = useRef(json);
  const escolher = useRef(onEscolher);
  const motorista = useRef(onMotorista);
  useEffect(() => {
    escolher.current = onEscolher;
    motorista.current = onMotorista;
  }, [onEscolher, onMotorista]);

  // O iframe fica isolado (sandbox): o MapLibre só carrega os tiles assim. A conversa é por mensagens.
  const enviar = () => ref.current?.contentWindow?.postMessage(JSON.stringify({ tipo: 'estado', estado: JSON.parse(ultimo.current) }), '*');

  useEffect(() => {
    ultimo.current = json;
    if (pronto.current) enviar();
  }, [json]);

  useEffect(() => {
    const ouvir = (e: MessageEvent) => {
      if (e.source !== ref.current?.contentWindow) return;
      try {
        const msg = JSON.parse(String(e.data));
        if (msg.tipo === 'pronto') {
          pronto.current = true;
          enviar();
        } else if (msg.tipo === 'pin') escolher.current?.({ lat: msg.lat, lon: msg.lon });
        else if (msg.tipo === 'motorista') motorista.current?.(msg.id);
      } catch {
        // ignora
      }
    };
    window.addEventListener('message', ouvir);
    return () => window.removeEventListener('message', ouvir);
  }, []);

  return (
    <View style={[s.caixa, style]}>
      <iframe ref={ref} srcDoc={html} sandbox="allow-scripts" title="Mapa" style={{ border: 0, width: '100%', height: '100%' }} />
    </View>
  );
}

const s = StyleSheet.create({ caixa: { height: 320, borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: cores.borda } });
