import type { ConfigContext, ExpoConfig } from 'expo/config';

// Um projeto, dois apps:
//   cliente (padrão)          → "Mercado Frete"
//   APP_VARIANT=admin         → "Frete Admin" (seu app para ver e gerenciar os pedidos)
export default ({ config }: ConfigContext): ExpoConfig => {
  const admin = process.env.APP_VARIANT === 'admin';
  const base = { ...config, extra: { ...config.extra, variante: admin ? 'admin' : 'cliente' } } as ExpoConfig;
  if (!admin) return base;
  return {
    ...base,
    name: 'Frete Admin',
    scheme: 'mercadofreteadmin',
    icon: './assets/admin-icon.png',
    ios: { ...base.ios, bundleIdentifier: 'br.com.mercadofrete.admin' },
    android: {
      ...base.android,
      package: 'br.com.mercadofrete.admin',
      adaptiveIcon: {
        ...base.android?.adaptiveIcon,
        backgroundColor: '#15201A',
        backgroundImage: './assets/admin-icon-background.png',
      },
    },
    plugins: [
      ...(base.plugins ?? []),
      [
        'expo-calendar',
        {
          calendarPermission: 'O Frete Admin coloca cada frete na sua agenda, com lembrete 15 minutos antes.',
          remindersPermission: false,
        },
      ],
    ],
  };
};
