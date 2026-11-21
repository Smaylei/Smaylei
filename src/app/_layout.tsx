import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { cores } from '../components/tema';
import { AppProvider } from '../estado/AppContext';
import { AgendaProvider } from '../hooks/useAgendaCelular';
// Registra a tarefa de localização em segundo plano (app do motorista) já na abertura do app.
import '../services/localizacao';

export default function Layout() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <AgendaProvider>
          <StatusBar style="dark" />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: cores.fundo },
              headerTintColor: cores.primaria,
              headerTitleStyle: { fontWeight: '700', color: cores.texto, fontSize: 17 },
              headerShadowVisible: false,
              contentStyle: { backgroundColor: cores.fundo },
              headerBackTitle: 'Voltar',
            }}
          >
            {/* cliente */}
            <Stack.Screen name="index" options={{ title: 'MOVI' }} />
            <Stack.Screen name="cadastro" options={{ title: 'Meu cadastro' }} />
            <Stack.Screen name="pedido" options={{ title: 'Pedido' }} />
            <Stack.Screen name="corrida/[id]" options={{ title: 'Seu frete' }} />
            <Stack.Screen name="chat/[id]" options={{ title: 'Chat' }} />
            <Stack.Screen name="pagamento" options={{ title: 'Pagamento' }} />
            <Stack.Screen name="checkout/[id]" options={{ title: 'Pagamento seguro' }} />
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
            <Stack.Screen name="servicos-admin" options={{ title: 'Serviços liberados' }} />
            <Stack.Screen name="ajustes" options={{ title: 'Ajustes' }} />
            <Stack.Screen name="tarifas" options={{ title: 'Tarifas' }} />
          </Stack>
        </AgendaProvider>
      </AppProvider>
    </SafeAreaProvider>
  );
}
