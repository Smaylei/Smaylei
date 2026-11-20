import type { ConfigContext, ExpoConfig } from 'expo/config';

// Um projeto, três apps (APP_VARIANT):
//   (padrão)   → "Mercado Frete"      app do cliente
//   motorista  → "Frete Motorista"    app do motorista parceiro
//   admin      → "Frete Admin"        app de gestão
type Variante = 'cliente' | 'motorista' | 'admin';

const CAMERA = 'A câmera é usada para a sua foto de identificação.';
const AGENDA = 'Os fretes aceitos entram na sua agenda, com lembrete 15 minutos antes.';

export default ({ config }: ConfigContext): ExpoConfig => {
  const v: Variante = process.env.APP_VARIANT === 'admin' ? 'admin' : process.env.APP_VARIANT === 'motorista' ? 'motorista' : 'cliente';
  const base = { ...config, extra: { ...config.extra, variante: v } } as ExpoConfig;
  const plugins = (base.plugins ?? []).filter((p) => (Array.isArray(p) ? p[0] : p) !== 'expo-location');
  const semAgenda = ['android.permission.READ_CALENDAR', 'android.permission.WRITE_CALENDAR'];
  const camera: [string, object] = ['expo-image-picker', { cameraPermission: CAMERA, photosPermission: 'Para escolher uma foto já tirada.', microphonePermission: false }];

  if (v === 'cliente')
    return {
      ...base,
      plugins: [...plugins, ['expo-location', { locationWhenInUsePermission: 'Usamos sua localização para marcar o endereço de entrega.' }], camera],
      android: { ...base.android, blockedPermissions: [...(base.android?.blockedPermissions ?? []), ...semAgenda] },
    };

  if (v === 'motorista')
    return {
      ...base,
      name: 'Frete Motorista',
      scheme: 'mercadofretemotorista',
      icon: './assets/motorista-icon.png',
      ios: {
        ...base.ios,
        bundleIdentifier: 'br.com.mercadofrete.motorista',
        infoPlist: { ...base.ios?.infoPlist, UIBackgroundModes: ['location', 'fetch'] },
      },
      android: {
        ...base.android,
        package: 'br.com.mercadofrete.motorista',
        adaptiveIcon: { ...base.android?.adaptiveIcon, backgroundColor: '#1F4FA8', backgroundImage: './assets/motorista-icon-background.png' },
        permissions: [...(base.android?.permissions ?? []), 'ACCESS_BACKGROUND_LOCATION', 'FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_LOCATION'],
      },
      plugins: [
        ...plugins,
        [
          'expo-location',
          {
            locationAlwaysAndWhenInUsePermission: 'Sua posição é enviada enquanto você está online, para receber corridas próximas e o cliente acompanhar a entrega.',
            locationWhenInUsePermission: 'Sua posição é usada para receber corridas próximas e o cliente acompanhar a entrega.',
            isAndroidBackgroundLocationEnabled: true,
            isAndroidForegroundServiceEnabled: true,
            isIosBackgroundLocationEnabled: true,
          },
        ],
        camera,
        ['expo-calendar', { calendarPermission: AGENDA, remindersPermission: false }],
        ['expo-notifications', {}],
      ],
    };

  return {
    ...base,
    name: 'Frete Admin',
    scheme: 'mercadofreteadmin',
    icon: './assets/admin-icon.png',
    ios: { ...base.ios, bundleIdentifier: 'br.com.mercadofrete.admin' },
    android: {
      ...base.android,
      package: 'br.com.mercadofrete.admin',
      adaptiveIcon: { ...base.android?.adaptiveIcon, backgroundColor: '#15201A', backgroundImage: './assets/admin-icon-background.png' },
    },
    plugins: [...plugins, ['expo-calendar', { calendarPermission: AGENDA, remindersPermission: false }]],
  };
};
