// Pagamento pela Pagar.me dentro do app: Pix (QR Code e copia e cola) e cartão à vista.
// O número do cartão vai direto do celular para a Pagar.me (chave pública) e volta um token;
// o servidor da MOVI só recebe esse token, nunca os dados do cartão.
import { router } from 'expo-router';
import { api } from './api';
import { SOLICITANTE } from '../variante';

export type TipoPagamento = 'corrida' | 'pedido' | 'mensalidade' | 'gorjeta';
export type Cobranca = {
  id: string;
  tipo: string;
  ref: string;
  status: 'pendente' | 'paga' | 'falhou';
  metodo: 'pix' | 'cartao';
  /** Total cobrado (valor + taxa do Pix/cartão). */
  valor: number;
  taxa?: number;
  liquido?: number;
  qrCode: string | null;
  qrCodeUrl: string | null;
  expiraEm: string | null;
  pagoEm: string | null;
  erro: string | null;
};
export type DadosCartao = { numero: string; nome: string; mes: string; ano: string; cvv: string };

export const pagar = (tipo: TipoPagamento, id: string, metodo: 'pix' | 'cartao', extra: { cardToken?: string; cep?: string } = {}) =>
  api<Cobranca>(SOLICITANTE, '/v2/pagar', { method: 'POST', corpo: { tipo, id, metodo, ...extra } });
export const cobranca = (id: string) => api<Cobranca>(SOLICITANTE, `/v2/cobrancas/${id}`);

/** Gera o token do cartão direto na Pagar.me (só com a chave pública, sem passar pelo servidor). */
export async function tokenizarCartao(chavePublica: string, c: DadosCartao): Promise<string> {
  const base = chavePublica.startsWith('pk_test_') ? 'https://sdx-api.pagar.me/core/v5' : 'https://api.pagar.me/core/v5';
  const r = await fetch(`${base}/tokens?appId=${encodeURIComponent(chavePublica)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'card',
      card: { number: c.numero.replace(/\D/g, ''), holder_name: c.nome.trim().toUpperCase(), exp_month: c.mes, exp_year: c.ano, cvv: c.cvv.replace(/\D/g, '') },
    }),
  }).catch(() => null);
  const d = ((await r?.json().catch(() => ({}))) ?? {}) as { id?: string; message?: string; errors?: Record<string, string[]> };
  if (!r?.ok || !d.id) {
    const det = d.errors ? Object.values(d.errors).flat().join(' ') : '';
    throw new Error(det || d.message || 'Confira os dados do cartão.');
  }
  return d.id;
}

/** Vai para o pagamento: tela própria (Pagar.me) ou o checkout da InfinitePay. */
export function irParaPagamento(gateway: 'infinitepay' | 'pagarme', tipo: TipoPagamento, id: string, opcoes: { substituir?: boolean; corrida?: string } = {}) {
  const destino =
    gateway === 'pagarme'
      ? { pathname: '/pagar' as const, params: { tipo, id } }
      : { pathname: '/checkout/[id]' as const, params: { id, ...(tipo === 'corrida' ? {} : { tipo }), ...(opcoes.corrida ? { corrida: opcoes.corrida } : {}) } };
  if (opcoes.substituir) router.replace(destino);
  else router.push(destino);
}
