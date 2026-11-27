import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import { Alert, Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { cores } from '../components/tema';
import { AppProvider } from '../estado/AppContext';
import { AgendaProvider } from '../hooks/useAgendaCelular';
// Registra a tarefa de localização em segundo plano (app do motorista) já na abertura do app.
import '../services/localizacao';

// No navegador (painel Admin web) o Alert do React Native não aparece: usa as janelas do navegador.
if (Platform.OS === 'web') {
  if (typeof document !== 'undefined') document.documentElement.style.backgroundColor = document.body.style.backgroundColor = cores.fundo;
  Alert.alert = (titulo, mensagem, botoes) => {
    const texto = [titulo, mensagem].filter(Boolean).join('\n\n');
    const acoes = (botoes ?? []).filter((b) => b.style !== 'cancel');
    if ((botoes?.length ?? 0) > 1) {
      if (globalThis.confirm(texto)) acoes[acoes.length - 1]?.onPress?.();
    } else {
      globalThis.alert(texto);
      botoes?.[0]?.onPress?.();
    }
  };
}

// Tema escuro também na navegação (fundo atrás das telas, inclusive no painel web).
const TEMA_NAVEGACAO = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: cores.fundo, card: cores.fundo, text: cores.texto, border: cores.borda, primary: cores.primaria },
};

export default function Layout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider value={TEMA_NAVEGACAO}>
        <AppProvider>
          <AgendaProvider>
            <StatusBar style="light" />
            <Stack
              screenOptions={{
                headerStyle: { backgroundColor: cores.fundo },
                headerTintColor: cores.texto,
                headerTitleStyle: { fontWeight: '700', color: cores.texto, fontSize: 17 },
                headerShadowVisible: false,
                // No computador (painel web), conteúdo centralizado com largura confortável.
                contentStyle:
                  Platform.OS === 'web'
                    ? { backgroundColor: cores.fundo, width: '100%', maxWidth: 1100, alignSelf: 'center' }
                    : { backgroundColor: cores.fundo },
                headerBackTitle: 'Voltar',
              }}
            >
              {/* escolha de perfil */}
              <Stack.Screen name="index" options={{ headerShown: false }} />
              <Stack.Screen name="entrar" options={{ title: '' }} />
            {/* cliente */}
              <Stack.Screen name="cliente" options={{ title: 'MOVI' }} />
              <Stack.Screen name="cadastro" options={{ title: 'Meu cadastro' }} />
              <Stack.Screen name="pedido" options={{ title: 'Pedido' }} />
              <Stack.Screen name="corrida/[id]" options={{ title: 'Seu frete' }} />
              <Stack.Screen name="chat/[id]" options={{ title: 'Chat' }} />
              <Stack.Screen name="pagamento" options={{ title: 'Pagamento' }} />
              <Stack.Screen name="checkout/[id]" options={{ title: 'Pagamento seguro' }} />
              <Stack.Screen name="pagar" options={{ title: 'Pagamento' }} />
              <Stack.Screen name="conta-recebimento" options={{ title: 'Conta para receber' }} />
              <Stack.Screen name="delivery" options={{ title: 'Delivery' }} />
              <Stack.Screen name="loja/[id]" options={{ title: 'Loja' }} />
              <Stack.Screen name="carrinho" options={{ title: 'Carrinho' }} />
              <Stack.Screen name="meu-pedido/[id]" options={{ title: 'Pedido' }} />
              {/* lojista */}
              <Stack.Screen name="lojista" options={{ title: 'MOVI Lojista' }} />
              <Stack.Screen name="cadastro-lojista" options={{ title: 'Cadastro de lojista' }} />
              <Stack.Screen name="vitrine" options={{ title: 'Minha vitrine' }} />
              <Stack.Screen name="produto-loja" options={{ title: 'Produto' }} />
              <Stack.Screen name="pedidos-loja" options={{ title: 'Pedidos do delivery' }} />
              {/* motorista */}
              <Stack.Screen name="motorista" options={{ title: 'MOVI Motorista' }} />
              <Stack.Screen name="cadastro-motorista" options={{ title: 'Cadastro de motorista' }} />
              <Stack.Screen name="agenda-motorista" options={{ title: 'Minha agenda' }} />
              <Stack.Screen name="corrida-motorista/[id]" options={{ title: 'Corrida' }} />
              <Stack.Screen name="saldo-motorista" options={{ title: 'Saldo e saques' }} />
              <Stack.Screen name="agenda-corridas" options={{ title: 'Agenda de corridas' }} />
              {/* admin */}
              <Stack.Screen name="painel" options={{ title: 'MOVI Admin' }} />
              <Stack.Screen name="motoristas-admin" options={{ title: 'Motoristas' }} />
              <Stack.Screen name="clientes-admin" options={{ title: 'Clientes' }} />
              <Stack.Screen name="saques-admin" options={{ title: 'Saques dos motoristas' }} />
              <Stack.Screen name="estornos-admin" options={{ title: 'Estornos' }} />
              <Stack.Screen name="avisos-admin" options={{ title: 'Avisos' }} />
              <Stack.Screen name="avaliacoes-admin" options={{ title: 'Avaliações e sugestões' }} />
              <Stack.Screen name="locais-admin" options={{ title: 'Locais' }} />
              <Stack.Screen name="servicos-admin" options={{ title: 'Serviços e cidades' }} />
              <Stack.Screen name="lojistas-admin" options={{ title: 'Lojistas' }} />
              <Stack.Screen name="mapa-admin" options={{ title: 'Mapa ao vivo' }} />
              <Stack.Screen name="delivery-admin" options={{ title: 'Delivery das lojas' }} />
              <Stack.Screen name="pagamentos-admin" options={{ title: 'Pagamentos (Pagar.me)' }} />
              <Stack.Screen name="ajustes" options={{ title: 'Ajustes' }} />
              <Stack.Screen name="tarifas" options={{ title: 'Tarifas' }} />
            </Stack>
          </AgendaProvider>
        </AppProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
