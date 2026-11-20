import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import TelaCalculo from './src/components/TelaCalculo';
import TelaTarifas from './src/components/TelaTarifas';
import { cores } from './src/components/tema';
import { TARIFAS_PADRAO } from './src/data/tarifas';
import { carregarMargem, carregarTarifas, salvarMargem, salvarTarifas } from './src/services/armazenamento';
import type { Tarifa } from './src/services/preco';

type Aba = 'calculo' | 'tarifas';

export default function App() {
  const [aba, setAba] = useState<Aba>('calculo');
  const [tarifas, setTarifas] = useState<Tarifa[]>(TARIFAS_PADRAO);
  const [margem, setMargem] = useState(0);

  useEffect(() => {
    carregarTarifas().then(setTarifas);
    carregarMargem().then(setMargem);
  }, []);

  function salvar(t: Tarifa[], m: number) {
    setTarifas(t);
    setMargem(m);
    salvarTarifas(t).catch(() => {});
    salvarMargem(m).catch(() => {});
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={s.raiz} edges={['top', 'bottom']}>
        <StatusBar style="dark" />
        <View style={s.cabecalho}>
          <Text style={s.titulo}>🛒 Mercado Frete</Text>
          <Text style={s.subtitulo}>Entrega de compras · Guaramirim/SC</Text>
        </View>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {aba === 'calculo' ? (
            <TelaCalculo tarifas={tarifas} margem={margem} />
          ) : (
            <TelaTarifas tarifas={tarifas} margem={margem} onSalvar={salvar} />
          )}
        </KeyboardAvoidingView>
        <View style={s.abas}>
          <BotaoAba ativo={aba === 'calculo'} texto="Calcular frete" onPress={() => setAba('calculo')} />
          <BotaoAba ativo={aba === 'tarifas'} texto="Tarifas Uber/99" onPress={() => setAba('tarifas')} />
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function BotaoAba({ ativo, texto, onPress }: { ativo: boolean; texto: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[s.aba, ativo && s.abaAtiva]} accessibilityRole="tab">
      <Text style={[s.abaTexto, ativo && s.abaTextoAtivo]}>{texto}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  raiz: { flex: 1, backgroundColor: cores.fundo },
  cabecalho: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, backgroundColor: cores.primaria },
  titulo: { fontSize: 22, fontWeight: '800', color: '#fff' },
  subtitulo: { fontSize: 13, color: '#D7F0E1', marginTop: 2 },
  abas: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: cores.borda, backgroundColor: cores.cartao },
  aba: { flex: 1, paddingVertical: 14, alignItems: 'center' },
  abaAtiva: { borderTopWidth: 3, borderTopColor: cores.primaria, paddingTop: 11 },
  abaTexto: { fontSize: 14, color: cores.suave, fontWeight: '600' },
  abaTextoAtivo: { color: cores.primaria },
});
