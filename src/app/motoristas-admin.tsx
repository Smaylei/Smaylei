import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { cores, raio, sombra } from '../components/tema';
import * as Admin from '../services/admin';
import { fonteImagem } from '../services/api';
import { formatarCpf } from '../services/cpf';
import { formatarReais } from '../services/preco';

type Fonte = { uri: string; headers?: Record<string, string> };

/** Motoristas parceiros: aprovar/bloquear, ver selfie e CNH e o saldo de cada um. */
export default function MotoristasAdmin() {
  const [lista, setLista] = useState<Admin.MotoristaAdmin[]>([]);
  const [aberto, setAberto] = useState<string | null>(null);
  const [fotos, setFotos] = useState<Record<string, Fonte>>({});

  const carregar = useCallback(async () => {
    try {
      setLista(await Admin.motoristas());
    } catch (e) {
      Alert.alert('Erro', (e as Error).message);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      const t = setTimeout(carregar, 0);
      return () => clearTimeout(t);
    }, [carregar]),
  );

  async function abrir(m: Admin.MotoristaAdmin) {
    setAberto(aberto === m.id ? null : m.id);
    const novas: Record<string, Fonte> = {};
    for (const chave of [m.selfie, m.cnh]) if (chave && !fotos[chave]) novas[chave] = await fonteImagem('admin', Admin.arquivo(chave));
    setFotos((f) => ({ ...f, ...novas }));
  }

  async function acao(fn: () => Promise<unknown>, ok?: string) {
    try {
      await fn();
      if (ok) Alert.alert('Pronto', ok);
      await carregar();
    } catch (e) {
      Alert.alert('Não deu certo', (e as Error).message);
    }
  }

  return (
    <ScrollView contentContainerStyle={s.conteudo} refreshControl={<RefreshControl refreshing={false} onRefresh={carregar} />}>
      {lista.length === 0 && <Text style={s.vazio}>Nenhum motorista cadastrado. Peça para baixarem o app MOVI Motorista.</Text>}
      {lista.map((m) => (
        <View key={m.id} style={[s.cartao, m.status === 'pendente' && { borderColor: cores.alerta, borderWidth: 1.5 }]}>
          <Pressable onPress={() => abrir(m)}>
            <View style={s.linha}>
              <Text style={s.nome}>{m.nome}</Text>
              <Text style={[s.selo, m.status === 'aprovado' ? s.ok : m.status === 'pendente' ? s.espera : s.bloq]}>
                {m.status === 'aprovado' ? (m.online ? 'ONLINE' : 'APROVADO') : m.status === 'pendente' ? 'PARA APROVAR' : 'BLOQUEADO'}
              </Text>
            </View>
            <Text style={s.detalhe}>
              {m.veiculo === 'moto' ? '🏍️ Moto · ' : '🚗 '}
              {m.carro}
              {m.cor ? ` ${m.cor}` : ''} · {m.placa} · {m.corridas} corridas
            </Text>
            <Text style={s.repasse}>Saldo: {formatarReais(m.disponivel)}{m.emLiberacao > 0 ? ` · em liberação ${formatarReais(m.emLiberacao)}` : ''} · total {formatarReais(m.totalGanho)}</Text>
          </Pressable>

          {aberto === m.id && (
            <View style={{ gap: 8, marginTop: 8 }}>
              <Text style={s.detalhe}>CPF (chave Pix) {formatarCpf(m.cpf)} · Tel. {m.telefone}</Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Doc rotulo="Selfie" fonte={m.selfie ? fotos[m.selfie] : undefined} />
                <Doc rotulo="CNH" fonte={m.cnh ? fotos[m.cnh] : undefined} largo />
              </View>
              <View style={s.botoes}>
                {m.status !== 'aprovado' && <Mini texto="Aprovar" onPress={() => acao(() => Admin.statusMotorista(m.id, 'aprovado'))} />}
                {m.status !== 'bloqueado' && <Mini texto="Bloquear" perigo onPress={() => acao(() => Admin.statusMotorista(m.id, 'bloqueado'))} />}
              </View>
            </View>
          )}
        </View>
      ))}
    </ScrollView>
  );
}

function Doc({ rotulo, fonte, largo }: { rotulo: string; fonte?: Fonte; largo?: boolean }) {
  return (
    <View style={{ gap: 4, flex: largo ? 1.4 : 1 }}>
      <Text style={s.detalhe}>{rotulo}</Text>
      {fonte ? <Image source={fonte} style={[s.doc, largo && { aspectRatio: 4 / 3 }]} resizeMode="cover" /> : <View style={[s.doc, s.docVazio]}><Text style={s.detalhe}>sem foto</Text></View>}
    </View>
  );
}

function Mini({ texto, onPress, perigo }: { texto: string; onPress: () => void; perigo?: boolean }) {
  return (
    <Pressable onPress={onPress} style={[s.mini, perigo && { backgroundColor: cores.erroFundo }]}>
      <Text style={[s.miniTexto, perigo && { color: cores.erro }]}>{texto}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  conteudo: { padding: 16, paddingBottom: 40, gap: 10 },
  vazio: { textAlign: 'center', color: cores.suave, marginTop: 20 },
  cartao: { backgroundColor: cores.cartao, borderRadius: raio, ...sombra, padding: 14 },
  linha: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  nome: { fontSize: 17, fontWeight: '700', color: cores.texto, flexShrink: 1 },
  selo: { fontSize: 10, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, overflow: 'hidden', color: '#fff' },
  ok: { backgroundColor: cores.primaria },
  espera: { backgroundColor: cores.alerta },
  bloq: { backgroundColor: cores.erro },
  detalhe: { fontSize: 13, color: cores.suave },
  repasse: { fontSize: 14, fontWeight: '700', color: cores.primaria, marginTop: 2 },
  doc: { width: '100%', aspectRatio: 1, borderRadius: 10, backgroundColor: cores.fundo },
  docVazio: { alignItems: 'center', justifyContent: 'center' },
  botoes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  mini: { backgroundColor: cores.primariaClara, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12 },
  miniTexto: { color: cores.primaria, fontWeight: '700', fontSize: 13 },
});
