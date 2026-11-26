import { Redirect, useLocalSearchParams } from 'expo-router';

/** Aberta pelo link mercadofrete://pagamento?... que o servidor manda depois do pagamento. */
export default function Pagamento() {
  const { corrida, pedido, mensalidade } = useLocalSearchParams<{ corrida?: string; pedido?: string; mensalidade?: string }>();
  if (pedido) return <Redirect href={`/meu-pedido/${pedido}`} />;
  if (mensalidade) return <Redirect href="/vitrine" />;
  return <Redirect href={corrida ? `/corrida/${corrida}` : '/'} />;
}
