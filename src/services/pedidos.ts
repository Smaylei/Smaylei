import AsyncStorage from '@react-native-async-storage/async-storage';

export type Pedido = {
  orderNsu: string;
  mercadoId: string;
  mercadoNome: string;
  valor: number;
  agendado: boolean;
  janela?: string; // ex.: "sex 21/11 · 10h–12h"
  criadoEm: string;
  checkoutUrl: string;
  status: 'aguardando' | 'pago';
  receiptUrl?: string;
  metodo?: string;
};

const CHAVE = 'pedidos:v1';

export async function listarPedidos(): Promise<Pedido[]> {
  try {
    const s = await AsyncStorage.getItem(CHAVE);
    return s ? JSON.parse(s) : [];
  } catch {
    return [];
  }
}

export async function salvarPedido(p: Pedido) {
  const todos = await listarPedidos();
  const i = todos.findIndex((x) => x.orderNsu === p.orderNsu);
  if (i >= 0) todos[i] = p;
  else todos.unshift(p);
  await AsyncStorage.setItem(CHAVE, JSON.stringify(todos.slice(0, 50)));
}
