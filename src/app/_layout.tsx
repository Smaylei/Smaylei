import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { cores } from '../components/tema';
import { AppProvider } from '../estado/AppContext';
import { AgendaProvider } from '../hooks/useAgendaCelular';
// Registra a tarefa de localização em segundo plano (app do motorista) já na abertura do app.
import '../services/localizacao';
import { VARIANTE } from '../variante';

const COR_TOPO = VARIANTE === 'motorista' ? '#1F4FA8' : VARIANTE === 'admin' ? '#15201A' : cores.primaria;

export default function Layout() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <AgendaProvider>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: COR_TOPO },
              headerTintColor: '#fff',
              headerTitleStyle: { fontWeight: '700' },
              contentStyle: { backgroundColor: cores.fundo },
              headerBackTitle: 'Voltar',
            }}
          >
            {/* cliente */}
            <Stack.Screen name="index" options={{ title: 'Mercado Frete' }} />
            <Stack.Screen name="cadastro" options={{ title: 'Meu cadastro' }} />
            <Stack.Screen name="pedido" options={{ title: 'Frete' }} />
            <Stack.Screen name="corrida/[id]" options={{ title: 'Seu frete' }} />
            <Stack.Screen name="chat/[id]" options={{ title: 'Chat' }} />
            <Stack.Screen name="pagamento" options={{ title: 'Pagamento' }} />
            {/* motorista */}
            <Stack.Screen name="motorista" options={{ title: 'Frete Motorista' }} />
            <Stack.Screen name="cadastro-motorista" options={{ title: 'Cadastro de motorista' }} />
            <Stack.Screen name="agenda-motorista" options={{ title: 'Minha agenda' }} />
            <Stack.Screen name="corrida-motorista/[id]" options={{ title: 'Corrida' }} />
            {/* admin */}
            <Stack.Screen name="painel" options={{ title: 'Frete Admin' }} />
            <Stack.Screen name="motoristas-admin" options={{ title: 'Motoristas' }} />
            <Stack.Screen name="clientes-admin" options={{ title: 'Clientes' }} />
            <Stack.Screen name="ajustes" options={{ title: 'Ajustes' }} />
            <Stack.Screen name="tarifas" options={{ title: 'Tarifas' }} />
          </Stack>
        </AgendaProvider>
      </AppProvider>
    </SafeAreaProvider>
  );
}
