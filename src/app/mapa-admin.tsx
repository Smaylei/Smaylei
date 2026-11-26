import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, useWindowDimensions, View } from 'react-native';
import MapaRuas, { type EstadoMapa } from '../components/MapaRuas';
import { COR_VEICULO, cores, raio } from '../components/tema';
import * as Admin from '../services/admin';

const ATUALIZAR_MS = 5000;
const ONLINE_MIN = 20; // sem posição nova há mais que isso = offline (igual ao servidor)
const ATIVAS = ['buscando', 'aceito', 'no_local', 'em_andamento'];
type Estado = 'livre' | 'corrida' | 'offline';
const ROTULO: Record<Estado, string> = { livre: 'Livre', corrida: 'Em corrida', offline: 'Offline' };
const COR: Record<Estado, string> = { livre: '#2DB36F', corrida: '#F27B1A', offline: '#6B737A' };

function ha(iso: string | null, agora: number) {
  if (!iso) return 'sem posição';
  const s = Math.max(0, Math.round((agora - Date.parse(iso)) / 1000));
  if (s < 60) return `há ${s} s`;
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  if (s < 86400) return `há ${Math.round(s / 3600)} h`;
  return `há ${Math.round(s / 86400)} dias`;
}

/** Mapa ao vivo (painel web): onde estão os motoristas agora e as corridas em andamento. */
export default function MapaAdmin() {
  const { width, height } = useWindowDimensions();
  const largo = width >= 900;
  const [mots, setMots] = useState<Admin.MotoristaAdmin[]>([]);
  const [corridas, setCorridas] = useState<Admin.CorridaAdmin[]>([]);
  const [agora, setAgora] = useState(0);
  const [verOffline, setVerOffline] = useState(true);
  const [foco, setFoco] = useState<{ lat: number; lon: number } | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const [m, c] = await Promise.all([Admin.motoristas(), Admin.corridas()]);
      setMots(m.filter((x) => x.status === 'aprovado'));
      setCorridas(c.filter((x) => ATIVAS.includes(x.status)));
      setAgora(Date.now());
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      const t0 = setTimeout(carregar, 0);
      const t = setInterval(carregar, ATUALIZAR_MS);
      return () => {
        clearTimeout(t0);
        clearInterval(t);
      };
    }, [carregar]),
  );

  const lista = useMemo(() => {
    const emCorrida = new Set(corridas.filter((c) => c.motorista_id && c.status !== 'buscando').map((c) => c.motorista_id));
    return mots
      .map((m) => {
        const recente = !!m.online && !!m.loc_em && agora - Date.parse(m.loc_em) < ONLINE_MIN * 60_000;
        const estado: Estado = !recente ? 'offline' : emCorrida.has(m.id) ? 'corrida' : 'livre';
        return { ...m, estado };
      })
      .sort((a, b) => ['corrida', 'livre', 'offline'].indexOf(a.estado) - ['corrida', 'livre', 'offline'].indexOf(b.estado) || a.nome.localeCompare(b.nome));
  }, [mots, corridas, agora]);

  const estadoMapa: EstadoMapa = useMemo(
    () => ({
      modo: 'frota',
      casa: null,
      foco,
      motoristas: lista
        .filter((m) => m.lat != null && m.lon != null && (verOffline || m.estado !== 'offline'))
        .map((m) => ({ id: m.id, nome: m.placa, lat: m.lat!, lon: m.lon!, moto: m.veiculo === 'moto', estado: m.estado })),
      mercados: corridas.flatMap((c) => [
        ...(c.coleta_lat != null && c.coleta_lon != null ? [{ id: `c-${c.id}`, curto: `📍 ${c.cliente_nome.split(' ')[0]}`, lat: c.coleta_lat, lon: c.coleta_lon }] : []),
        ...(c.entrega_lat != null && c.entrega_lon != null ? [{ id: `d-${c.id}`, curto: `🏁 ${c.cliente_nome.split(' ')[0]}`, lat: c.entrega_lat, lon: c.entrega_lon }] : []),
      ]),
    }),
    [lista, corridas, verOffline, foco],
  );

  const conta = (e: Estado) => lista.filter((m) => m.estado === e).length;

  return (
    <View style={[s.tela, largo && { flexDirection: 'row', height: Math.max(520, height - 90) }]}>
      <View style={[s.mapaCaixa, largo ? { flex: 1, height: '100%' } : { height: 420 }]}>
        <MapaRuas
          estado={estadoMapa}
          style={{ height: '100%' as never, borderRadius: 0, borderWidth: 0 }}
          onMotorista={(id) => {
            const m = lista.find((x) => x.id === id);
            if (m)
              Alert.alert(m.nome, `${m.veiculo === 'moto' ? 'Moto' : 'Carro'} ${m.carro} · ${m.placa}\n${ROTULO[m.estado]} · posição ${ha(m.loc_em, agora)}\nTel. ${m.telefone}`);
          }}
        />
      </View>
      <View style={largo ? { width: 340, height: '100%' } : { flex: 1 }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 10 }}>
          <View style={s.resumo}>
            {(['livre', 'corrida', 'offline'] as Estado[]).map((e) => (
              <View key={e} style={s.resumoItem}>
                <Text style={[s.resumoNum, { color: COR[e] }]}>{conta(e)}</Text>
                <Text style={s.resumoTxt}>{ROTULO[e]}</Text>
              </View>
            ))}
          </View>
          <View style={s.linha}>
            <Text style={s.sub}>Mostrar offline (última posição)</Text>
            <Switch value={verOffline} onValueChange={setVerOffline} trackColor={{ true: cores.primaria }} />
          </View>
          <View style={s.legenda}>
            <View style={[s.ponto, { backgroundColor: COR_VEICULO.carro }]} />
            <Text style={s.sub}>Carro</Text>
            <View style={[s.ponto, { backgroundColor: COR_VEICULO.moto, marginLeft: 12 }]} />
            <Text style={s.sub}>Moto</Text>
          </View>
          <Text style={s.sub}>Atualiza a cada 5 s. Toque num motorista para centralizar o mapa.</Text>
          {erro && <Text style={s.erro}>{erro}</Text>}
          {lista.length === 0 && <Text style={s.sub}>Nenhum motorista aprovado ainda.</Text>}
          {lista.map((m) => (
            <Pressable
              key={m.id}
              style={[s.cartao, m.lat == null && { opacity: 0.55 }]}
              disabled={m.lat == null}
              onPress={() => m.lat != null && setFoco({ lat: m.lat, lon: m.lon! })}
            >
              <View style={[s.ponto, { backgroundColor: COR_VEICULO[m.veiculo === 'moto' ? 'moto' : 'carro'] }, m.estado === 'offline' && { opacity: 0.4 }]} />
              <View style={{ flex: 1 }}>
                <Text style={s.nome}>{m.nome}</Text>
                <Text style={s.sub}>
                  {m.placa} · <Text style={{ color: COR[m.estado], fontWeight: '600' }}>{ROTULO[m.estado]}</Text> · {ha(m.loc_em, agora)}
                </Text>
              </View>
            </Pressable>
          ))}
          {corridas.length > 0 && <Text style={[s.sub, { marginTop: 8, fontWeight: '700' }]}>Corridas em andamento</Text>}
          {corridas.map((c) => (
            <View key={c.id} style={s.corrida}>
              <Text style={s.nome}>{c.cliente_nome}</Text>
              <Text style={s.sub}>
                {c.status === 'buscando'
                  ? 'Procurando motorista'
                  : `${c.motorista_nome ?? ''} · ${c.status === 'em_andamento' ? 'a caminho do destino' : c.status === 'no_local' ? 'na coleta' : 'indo à coleta'}`}
              </Text>
            </View>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  tela: { flex: 1, backgroundColor: cores.fundo },
  mapaCaixa: { overflow: 'hidden' },
  resumo: { flexDirection: 'row', gap: 8 },
  resumoItem: { flex: 1, backgroundColor: cores.cartao, borderRadius: raio, padding: 10, alignItems: 'center', borderWidth: 1, borderColor: cores.borda },
  resumoNum: { fontSize: 22, fontWeight: '800' },
  resumoTxt: { fontSize: 12, color: cores.suave },
  linha: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sub: { fontSize: 13, color: cores.suave },
  erro: { color: cores.erro, fontSize: 13 },
  cartao: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: cores.cartao, borderRadius: raio, padding: 12, borderWidth: 1, borderColor: cores.borda },
  ponto: { width: 10, height: 10, borderRadius: 5 },
  legenda: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  nome: { fontSize: 15, fontWeight: '700', color: cores.texto },
  corrida: { backgroundColor: cores.cartao, borderRadius: raio, padding: 12, gap: 2, borderLeftWidth: 3, borderLeftColor: '#F27B1A' },
});
