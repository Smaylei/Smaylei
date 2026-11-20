import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { cores } from '../components/tema';
import { AppProvider } from '../estado/AppContext';

export default function Layout() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: cores.primaria },
            headerTintColor: '#fff',
            headerTitleStyle: { fontWeight: '700' },
            contentStyle: { backgroundColor: cores.fundo },
            headerBackTitle: 'Voltar',
          }}
        >
          <Stack.Screen name="index" options={{ title: 'Mercado Frete' }} />
          <Stack.Screen name="cadastro" options={{ title: 'Meu endereço' }} />
          <Stack.Screen name="pedido" options={{ title: 'Frete' }} />
          <Stack.Screen name="admin" options={{ title: 'Tarifas (administração)' }} />
        </Stack>
      </AppProvider>
    </SafeAreaProvider>
  );
}
