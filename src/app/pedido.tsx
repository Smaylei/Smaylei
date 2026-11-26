import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SeletorPonta, { escolhaCasa, type Escolha } from '../components/SeletorPonta';
import { cores, raio, sombra } from '../components/tema';
import { servicoPorId } from '../data/servicos';
import { useApp } from '../estado/AppContext';
import { useCotacoes } from '../hooks/useCotacoes';
import { api, type CorridaCliente, type Disponibilidade } from '../services/api';
import { formatarReais } from '../services/preco';
import { SOLICITANTE } from '../variante';

export default function PedidoTela() {
  const params = useLocalSearchParams<{ servico?: string; modo?: string }>();
  const sv = servicoPorId(params.servico ?? 'comigo');
  const { casa, recarregarConfig, config } = useApp();
  const insets = useSafeAreaInsets();
  const [agendado, setAgendado] = useState(params.modo === 'agendar' || !!sv.variosDias);
  const [disp, setDisp] = useState<Disponibilidade | null>(null);
  // A casa já vem marcada no lado em que ela é o padrão.
  const [coleta, setColeta] = useState<Escolha | null>(casa && sv.coleta.casa && !sv.entrega.casa ? escolhaCasa(casa, SOLICITANTE) : casa && sv.coleta.casa && sv.variosDias ? escolhaCasa(casa, SOLICITANTE) : null);
  const [entrega, setEntrega] = useState<Escolha | null>(casa && sv.entrega.casa && !sv.coleta.casa ? escolhaCasa(casa, SOLICITANTE) : null);
  const [descricao, setDescricao] = useState('');
  // Se a casa/loja carregar depois de abrir a tela, já deixa marcada no lado padrão.
  useEffect(() => {
    if (!casa) return;
    const t = setTimeout(() => {
      if (sv.coleta.casa && (!sv.entrega.casa || sv.variosDias)) setColeta((c) => c ?? escolhaCasa(casa, SOLICITANTE));
      if (sv.entrega.casa && !sv.coleta.casa) setEntrega((e) => e ?? escolhaCasa(casa, SOLICITANTE));
    }, 0);
    return () => clearTimeout(t);
  }, [casa, sv]);
  // agendamento de um dia
  const [diaIdx, setDiaIdx] = useState(0);
  const [inicio, setInicio] = useState<string | null>(null);
  // vários dias (carro na oficina)
  const [dias, setDias] = useState<string[]>([]);
  const [horaIda, setHoraIda] = useState<string | null>(null);
  const [comVolta, setComVolta] = useState(false);
  const [horaVolta, setHoraVolta] = useState<string | null>(null);
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

  // Preço de cada opção da lista, com o outro lado já escolhido.
  // Valor calculado pelo servidor (rota OSRM + tarifas do Admin): é o mesmo cobrado no pedido.
  const destinoCot = useMemo(() => (entrega ? [{ id: 'd', lat: entrega.lat, lon: entrega.lon }] : []), [entrega]);
  const cot = useCotacoes(sv.id, agendado, coleta, destinoCot);
  const valor = coleta && entrega ? (cot.d?.valor ?? null) : null;

  // Viagens do pedido.
  const horarioDe = (data: string, hora: string | null) => disp?.dias.find((d) => d.data === data)?.horarios.find((h) => h.hora === hora)?.inicio ?? null;
  const viagens = useMemo(() => {
    if (!agendado) return { idas: [] as string[], voltas: [] as string[], faltando: [] as string[] };
    if (!sv.variosDias) return { idas: inicio ? [inicio] : [], voltas: [], faltando: [] };
    const faltando: string[] = [];
    const idas: string[] = [], voltas: string[] = [];
    for (const d of dias) {
      const rot = disp?.dias.find((x) => x.data === d)?.rotulo ?? d;
      const i = horaIda ? horarioDe(d, horaIda) : null;
      if (horaIda && !i) faltando.push(`${rot} ${horaIda}`);
      if (i) idas.push(i);
      if (comVolta) {
        const v = horaVolta ? horarioDe(d, horaVolta) : null;
        if (horaVolta && !v) faltando.push(`${rot} ${horaVolta}`);
        if (v) voltas.push(v);
      }
    }
    return { idas, voltas, faltando };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agendado, sv.variosDias, inicio, dias, horaIda, comVolta, horaVolta, disp]);
  const qtd = agendado ? viagens.idas.length + viagens.voltas.length : 1;
  const horasDisponiveis = useMemo(() => {
    const todas = new Set<string>();
    for (const d of disp?.dias ?? []) if (!dias.length || dias.includes(d.data)) d.horarios.forEach((h) => todas.add(h.hora));
    return [...todas].sort();
  }, [disp, dias]);

  const agoraOk = agendado || (disp?.agora.ok ?? false);
  const pronto =
    !!coleta && !!entrega && valor !== null && agoraOk && (!sv.descricao || descricao.trim().length >= 3) && (!agendado || qtd > 0) && viagens.faltando.length === 0 && (!comVolta || !!horaVolta);

  async function chamar() {
    if (!coleta || !entrega) return;
    setEnviando(true);
    setErro(null);
    try {
      const c = await api<CorridaCliente>('cliente', '/v2/corridas', {
        method: 'POST',
        corpo: {
          servico: sv.id, coleta: coleta.corpo, entrega: entrega.corpo, descricao: descricao.trim() || undefined, agendado,
          inicios: agendado ? viagens.idas : undefined, voltas: agendado && viagens.voltas.length ? viagens.voltas : undefined,
        },
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

  const dia = disp?.dias[diaIdx];
  if (!config.servicosAtivos.includes(sv.id))
    return (
      <View style={[s.conteudo, { alignItems: 'center', marginTop: 40 }]}>
        <Stack.Screen options={{ title: sv.titulo }} />
        <Text style={{ fontSize: 40 }}>{sv.icone}</Text>
        <Text style={s.secao}>Em breve!</Text>
        <Text style={s.infoTexto}>“{sv.titulo}” ainda não está disponível. Por enquanto atendemos os mercados.</Text>
      </View>
    );
  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: sv.titulo }} />
      <ScrollView contentContainerStyle={s.conteudo} keyboardShouldPersistTaps="handled">
        <View style={s.cabeca}>
          <Text style={s.cabecaIcone}>{sv.icone}</Text>
          <Text style={s.cabecaTexto}>{sv.sub}</Text>
        </View>
        {sv.aviso && <Text style={s.aviso}>ℹ️ {sv.aviso}</Text>}

        <SeletorPonta ponta={sv.coleta} valor={coleta} onChange={setColeta} servico={sv.id} agendado={agendado} base={entrega} />
        <SeletorPonta ponta={sv.entrega} valor={entrega} onChange={setEntrega} servico={sv.id} agendado={agendado} base={coleta} />

        {sv.descricao && (
          <>
            <Text style={s.secao}>{sv.descricao.rotulo}</Text>
            <TextInput
              style={[s.input, { minHeight: 70 }]}
              value={descricao}
              onChangeText={setDescricao}
              placeholder={sv.descricao.exemplo}
              placeholderTextColor={cores.apagado}
              multiline
              maxLength={300}
              textAlignVertical="top"
            />
          </>
        )}

        <Text style={s.secao}>Quando?</Text>
        {!sv.variosDias && (
          <View style={s.segmento}>
            <Pressable style={[s.segItem, !agendado && s.segAtivo]} onPress={() => setAgendado(false)}>
              <Text style={[s.segTexto, !agendado && s.segTextoAtivo]}>Agora</Text>
            </Pressable>
            <Pressable style={[s.segItem, agendado && s.segAtivo]} onPress={() => setAgendado(true)}>
              <Text style={[s.segTexto, agendado && s.segTextoAtivo]}>Agendar</Text>
            </Pressable>
          </View>
        )}
        {!agendado && disp && !disp.agora.ok && (
          <View style={s.indisp}>
            <Text style={s.indispTitulo}>Indisponível agora</Text>
            <Text style={s.indispTexto}>{disp.agora.motivo}</Text>
          </View>
        )}
        {agendado && !disp && <ActivityIndicator color={cores.primaria} />}
        {agendado && disp && disp.dias.length === 0 && <Text style={s.indispTexto}>Sem horários livres no momento.</Text>}

        {agendado && disp && !sv.variosDias && disp.dias.length > 0 && (
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

        {agendado && disp && sv.variosDias && disp.dias.length > 0 && (
          <>
            <Text style={s.sub}>Dias (toque em todos que precisar)</Text>
            <View style={s.faixas}>
              {disp.dias.map((d) => (
                <Chip key={d.data} texto={d.rotulo} ativo={dias.includes(d.data)} onPress={() => setDias((a) => (a.includes(d.data) ? a.filter((x) => x !== d.data) : [...a, d.data].sort()))} />
              ))}
            </View>
            <Text style={s.sub}>Horário da ida</Text>
            <View style={s.faixas}>
              {horasDisponiveis.map((h) => (
                <Chip key={h} texto={h} ativo={horaIda === h} onPress={() => setHoraIda(h)} />
              ))}
            </View>
            <Pressable onPress={() => setComVolta(!comVolta)} style={s.volta}>
              <Text style={s.voltaTexto}>{comVolta ? '☑' : '☐'} Também a volta (do destino para a coleta)</Text>
            </Pressable>
            {comVolta && (
              <>
                <Text style={s.sub}>Horário da volta</Text>
                <View style={s.faixas}>
                  {horasDisponiveis.map((h) => (
                    <Chip key={h} texto={h} ativo={horaVolta === h} onPress={() => setHoraVolta(h)} />
                  ))}
                </View>
              </>
            )}
            {viagens.faltando.length > 0 && <Text style={s.erro}>Sem vaga em: {viagens.faltando.join(', ')}. Escolha outro horário ou tire o dia.</Text>}
          </>
        )}

        <View style={s.info}>
          <Text style={s.infoTexto}>
            🔒 Você paga agora, dentro do app (Pix ou cartão à vista). O valor fica retido e só é liberado ao motorista quando{' '}
            {sv.clienteNaColeta ? 'você confirmar que ele chegou.' : 'você confirmar que recebeu.'}
          </Text>
          <Text style={s.infoTexto}>Se nenhum motorista aceitar ou você cancelar antes da chegada, o valor é devolvido.</Text>
        </View>
        {erro && <Text style={s.erro}>{erro}</Text>}
      </ScrollView>

      <View style={[s.rodape, { paddingBottom: 12 + insets.bottom }]}>
        <View style={{ flex: 1 }}>
          <Text style={s.rodapeRotulo}>{qtd > 1 ? `${qtd} viagens × ${valor != null ? formatarReais(valor) : '—'}` : agendado ? 'Agendado' : 'Agora'}</Text>
          <Text style={s.rodapeValor}>{valor === null ? '—' : formatarReais(Math.round(valor * Math.max(qtd, 1) * 100) / 100)}</Text>
        </View>
        <Pressable style={[s.botao, (!pronto || enviando) && { opacity: 0.45 }]} disabled={!pronto || enviando} onPress={chamar}>
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
  conteudo: { padding: 16, paddingBottom: 30, gap: 10 },
  cabeca: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: cores.primariaClara, borderRadius: raio, padding: 14 },
  cabecaIcone: { fontSize: 30 },
  cabecaTexto: { flex: 1, fontSize: 14, color: cores.texto, lineHeight: 20 },
  aviso: { fontSize: 13, color: cores.alerta, backgroundColor: cores.alertaFundo, borderRadius: 12, padding: 10, lineHeight: 18 },
  secao: { fontSize: 16, fontWeight: '700', color: cores.texto, marginTop: 8 },
  sub: { fontSize: 13, fontWeight: '600', color: cores.suave, marginTop: 4 },
  input: { backgroundColor: cores.cartao, borderRadius: 12, padding: 12, fontSize: 15, color: cores.texto, ...sombra },
  segmento: { flexDirection: 'row', backgroundColor: cores.cartao, borderRadius: 999, padding: 4, ...sombra },
  segItem: { flex: 1, paddingVertical: 10, borderRadius: 999, alignItems: 'center' },
  segAtivo: { backgroundColor: cores.primaria },
  segTexto: { fontSize: 15, fontWeight: '600', color: cores.texto },
  segTextoAtivo: { color: '#fff' },
  faixas: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { ...sombra, borderRadius: 999, paddingVertical: 9, paddingHorizontal: 14, backgroundColor: cores.cartao },
  chipAtivo: { backgroundColor: cores.primaria },
  chipTexto: { fontSize: 14, fontWeight: '600', color: cores.texto },
  volta: { paddingVertical: 8 },
  voltaTexto: { fontSize: 15, color: cores.texto, fontWeight: '600' },
  indisp: { backgroundColor: cores.alertaFundo, borderRadius: 12, padding: 12, gap: 4 },
  indispTitulo: { color: cores.alerta, fontSize: 15, fontWeight: '700' },
  indispTexto: { color: cores.alerta, fontSize: 14 },
  info: { marginTop: 10, gap: 4 },
  infoTexto: { fontSize: 13, color: cores.suave, lineHeight: 18 },
  erro: { color: cores.erro, marginTop: 6, fontSize: 14 },
  rodape: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 12, backgroundColor: cores.cartao, borderTopWidth: 1, borderTopColor: cores.borda },
  rodapeRotulo: { fontSize: 13, color: cores.suave },
  rodapeValor: { fontSize: 26, fontWeight: '700', color: cores.primaria, fontVariant: ['tabular-nums'] },
  botao: { backgroundColor: cores.primaria, borderRadius: raio, paddingVertical: 16, paddingHorizontal: 22, alignItems: 'center' },
  botaoTexto: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
