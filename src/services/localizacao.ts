// Envio da posição do motorista enquanto ele está online, inclusive com o app em segundo plano.
// A cada posição o servidor responde quantas corridas estão disponíveis; havendo novas,
// o celular mostra uma notificação (sem precisar de serviço de push).
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { api } from './api';

export const TAREFA = 'mercado-frete-localizacao';
let ultimasOfertas = 0;

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

export async function enviarPosicao(lat: number, lon: number) {
  const r = await api<{ ofertas: number }>('motorista', '/v2/eu/local', { method: 'POST', corpo: { lat, lon } });
  if (r.ofertas > ultimasOfertas) {
    await Notifications.scheduleNotificationAsync({
      content: { title: '🛒 Nova corrida disponível', body: 'Abra o MOVI Motorista para aceitar.', sound: true },
      trigger: null,
    }).catch(() => {});
  }
  ultimasOfertas = r.ofertas;
  return r;
}

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(TAREFA, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;
  const p = data.locations[data.locations.length - 1].coords;
  await enviarPosicao(p.latitude, p.longitude).catch(() => {});
});

/** Começa a enviar a posição. Retorna se conseguiu também em segundo plano. */
export async function iniciarRastreio(): Promise<{ segundoPlano: boolean }> {
  const frente = await Location.requestForegroundPermissionsAsync();
  if (frente.status !== 'granted') throw new Error('Permita o acesso à localização para ficar online.');
  await Notifications.requestPermissionsAsync().catch(() => {});
  let segundoPlano = false;
  try {
    segundoPlano = (await Location.requestBackgroundPermissionsAsync()).status === 'granted';
  } catch {
    segundoPlano = false;
  }
  if (segundoPlano && !(await Location.hasStartedLocationUpdatesAsync(TAREFA).catch(() => false))) {
    await Location.startLocationUpdatesAsync(TAREFA, {
      accuracy: Location.Accuracy.Balanced,
      // A cada 15 s mesmo parado (com distância mínima, o carro estacionado sumia como "indisponível").
      timeInterval: 15_000,
      distanceInterval: 0,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'MOVI Motorista: você está online',
        notificationBody: 'Recebendo corridas e compartilhando sua posição com o cliente.',
        notificationColor: '#3D6FD1',
      },
    });
  }
  return { segundoPlano };
}

export async function pararRastreio() {
  if (await Location.hasStartedLocationUpdatesAsync(TAREFA).catch(() => false)) await Location.stopLocationUpdatesAsync(TAREFA);
}

export async function posicaoAtual() {
  const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  return { lat: p.coords.latitude, lon: p.coords.longitude };
}
