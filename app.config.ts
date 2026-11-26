import type { ConfigContext, ExpoConfig } from 'expo/config';

// MOVI — um app só. Ao abrir, a pessoa escolhe: Cliente, Motorista ou Lojista (e volta pelo "Início").
// O painel Admin roda no navegador do computador: APP_VARIANT=admin npx expo export --platform web
// (os identificadores br.com.mercadofrete.* continuam: o app atualiza por cima, sem perder o cadastro.)
type Variante = 'app' | 'admin';

const CAMERA = 'A câmera é usada para a sua foto de identificação e, no caso de motoristas, para a CNH.';
const AGENDA = 'As corridas aceitas entram na sua agenda, com lembrete 15 minutos antes.';

export default ({ config }: ConfigContext): ExpoConfig => {
  const v: Variante = process.env.APP_VARIANT === 'admin' ? 'admin' : 'app';
  const base = { ...config, extra: { ...config.extra, variante: v === 'admin' ? 'admin' : 'cliente' } } as ExpoConfig;
  const plugins = (base.plugins ?? []).filter((p) => (Array.isArray(p) ? p[0] : p) !== 'expo-location');

  if (v === 'admin') return { ...base, name: 'MOVI Admin', web: { ...base.web, name: 'MOVI Admin', shortName: 'MOVI Admin', themeColor: '#0A0B0D', backgroundColor: '#0A0B0D' } };

  return {
    ...base,
    name: 'MOVI',
    ios: { ...base.ios, infoPlist: { ...base.ios?.infoPlist, UIBackgroundModes: ['location', 'fetch'] } },
    android: {
      ...base.android,
      permissions: [...(base.android?.permissions ?? []), 'ACCESS_BACKGROUND_LOCATION', 'FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_LOCATION'],
    },
    plugins: [
      ...plugins,
      [
        'expo-location',
        {
          locationAlwaysAndWhenInUsePermission: 'No modo Motorista, sua posição é enviada enquanto você está online, para receber corridas e o cliente acompanhar o trajeto.',
          locationWhenInUsePermission: 'Usamos sua localização para marcar endereços e acompanhar as corridas.',
          isAndroidBackgroundLocationEnabled: true,
          isAndroidForegroundServiceEnabled: true,
          isIosBackgroundLocationEnabled: true,
        },
      ],
      ['expo-image-picker', { cameraPermission: CAMERA, photosPermission: 'Para escolher uma foto já tirada.', microphonePermission: false }],
      ['expo-calendar', { calendarPermission: AGENDA, remindersPermission: false }],
      ['expo-notifications', {}],
    ],
  };
};
