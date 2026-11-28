// Taxa do meio de pagamento "por cima": o cliente paga a taxa do Pix/cartão para que, depois que a
// Pagar.me desconta a taxa, sobre exatamente o valor mostrado para motorista, loja e MOVI.
export type TaxaMeio = { pct: number; fixo: number };

/**
 * Taxa de serviço da MOVI sobre o valor do solicitante (100% da MOVI; o motorista recebe o que viu no
 * aceite). Em centavos, a mesma conta no app e no servidor.
 */
export const taxaServico = (valor: number, pct: number) => (valor > 0 && pct > 0 ? Math.round(valor * pct) / 100 : 0);

/** Total a cobrar e a taxa embutida, para que total − (pct × total + fixo) ≥ líquido. */
export function comTaxa(liquido: number, t: TaxaMeio): { total: number; taxa: number } {
  if (!(liquido > 0)) return { total: 0, taxa: 0 };
  const pct = Math.min(Math.max(Number(t.pct) || 0, 0), 50) / 100;
  const fixo = Math.max(Number(t.fixo) || 0, 0);
  if (!pct && !fixo) return { total: Math.round(liquido * 100) / 100, taxa: 0 };
  const total = Math.ceil(((liquido + fixo) / (1 - pct)) * 100 - 1e-6) / 100;
  return { total, taxa: Math.round((total - liquido) * 100) / 100 };
}
