import { Redirect, useLocalSearchParams } from 'expo-router';

/** Aberta pelo link mercadofrete://pagamento?corrida=... que o servidor manda depois do pagamento. */
export default function Pagamento() {
  const { corrida } = useLocalSearchParams<{ corrida?: string }>();
  return <Redirect href={corrida ? `/corrida/${corrida}` : '/'} />;
}
