// Carrinho do delivery: uma loja por vez, guardado na memória do app enquanto ele estiver aberto.
import { useSyncExternalStore } from 'react';
import type { Produto } from '../services/delivery';

export type Carrinho = { lojaId: string | null; lojaNome: string; itens: { produto: Produto; qtd: number }[] };
let estado: Carrinho = { lojaId: null, lojaNome: '', itens: [] };
const ouvintes = new Set<() => void>();
const mudar = (novo: Carrinho) => {
  estado = novo;
  ouvintes.forEach((f) => f());
};
const assinar = (f: () => void) => {
  ouvintes.add(f);
  return () => {
    ouvintes.delete(f);
  };
};

export const useCarrinho = () => useSyncExternalStore(assinar, () => estado, () => estado);

/** Soma (ou tira) do produto; trocar de loja esvazia o carrinho. */
export function alterarItem(loja: { id: string; nome: string }, produto: Produto, delta: number) {
  const base = estado.lojaId === loja.id ? estado.itens : [];
  const atual = base.find((i) => i.produto.id === produto.id)?.qtd ?? 0;
  const qtd = Math.max(0, Math.min(99, atual + delta));
  const itens = qtd ? (atual ? base.map((i) => (i.produto.id === produto.id ? { ...i, qtd } : i)) : [...base, { produto, qtd }]) : base.filter((i) => i.produto.id !== produto.id);
  mudar({ lojaId: itens.length ? loja.id : null, lojaNome: itens.length ? loja.nome : '', itens });
}
export const outraLoja = (lojaId: string) => !!estado.lojaId && estado.lojaId !== lojaId && estado.itens.length > 0;
export const esvaziar = () => mudar({ lojaId: null, lojaNome: '', itens: [] });
export const qtdItens = (c: Carrinho) => c.itens.reduce((s, i) => s + i.qtd, 0);
export const subtotal = (c: Carrinho) => Math.round(c.itens.reduce((s, i) => s + i.produto.preco * i.qtd, 0) * 100) / 100;
