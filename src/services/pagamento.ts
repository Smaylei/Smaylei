// Pagamento do frete pelo Checkout Integrado da InfinitePay.
// Docs: https://www.infinitepay.io/checkout-documentacao
// Criar o link só exige a InfiniteTag (handle); nenhuma chave secreta fica no app.

import { INFINITEPAY_HANDLE } from '../config';

const API = 'https://api.checkout.infinitepay.io';
const MINIMO_CENTAVOS = 100; // a InfinitePay não aceita pagamentos abaixo de R$ 1,00

export type NovoPagamento = {
  orderNsu: string;
  valor: number; // em reais
  descricao: string;
  redirectUrl?: string;
  cliente?: { name?: string; email?: string; phone_number?: string };
};

export type RetornoPagamento = {
  receiptUrl?: string;
  orderNsu?: string;
  slug?: string;
  captureMethod?: string;
  transactionNsu?: string;
};

export type StatusPagamento = {
  pago: boolean;
  valorPago?: number;
  metodo?: string;
};

export class ErroPagamento extends Error {}

function mensagemErro(codigo: string | undefined, padrao: string) {
  if (codigo === 'external_checkout_not_enabled')
    return 'O recebimento pelo app ainda não está ativado na InfinitePay. Ative "Checkout integrado" nas configurações do Checkout da InfinitePay.';
  return padrao;
}

/** Gera o link de pagamento e devolve a URL do checkout. */
export async function criarLinkPagamento(p: NovoPagamento): Promise<string> {
  const centavos = Math.round(p.valor * 100);
  if (centavos < MINIMO_CENTAVOS) throw new ErroPagamento('O valor mínimo para pagamento é R$ 1,00.');
  const corpo: Record<string, unknown> = {
    handle: INFINITEPAY_HANDLE,
    items: [{ quantity: 1, price: centavos, description: p.descricao.slice(0, 120) }],
    order_nsu: p.orderNsu,
  };
  if (p.redirectUrl?.startsWith('https://')) corpo.redirect_url = p.redirectUrl; // a API recusa outros esquemas
  if (p.cliente && Object.values(p.cliente).some(Boolean)) corpo.customer = p.cliente;

  let resp: Response;
  try {
    resp = await fetch(`${API}/links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(corpo),
    });
  } catch {
    throw new ErroPagamento('Sem conexão com a InfinitePay. Verifique a internet e tente de novo.');
  }
  const dados: Record<string, unknown> = await resp.json().catch(() => ({}));
  // Resposta observada: { url: "https://checkout.infinitepay.io/<handle>?lenc=..." }
  const url = [dados.url, dados.checkout_url, dados.link, dados.payment_url].find(
    (v): v is string => typeof v === 'string' && v.startsWith('http'),
  );
  if (!resp.ok || dados.success === false || !url) {
    throw new ErroPagamento(
      mensagemErro(dados.error as string | undefined, 'Não foi possível gerar o pagamento agora. Tente de novo.'),
    );
  }
  return url;
}

/** Lê os parâmetros que a InfinitePay acrescenta à redirect_url após o pagamento. */
export function lerRetorno(url: string): RetornoPagamento {
  const q = url.includes('?') ? url.slice(url.indexOf('?') + 1).split('#')[0] : '';
  const params: Record<string, string> = {};
  for (const par of q.split('&')) {
    if (!par) continue;
    const [k, v = ''] = par.split('=');
    params[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '));
  }
  return {
    receiptUrl: params.receipt_url,
    orderNsu: params.order_nsu,
    slug: params.slug,
    captureMethod: params.capture_method,
    transactionNsu: params.transaction_nsu,
  };
}

/** Confirma na InfinitePay se o pagamento foi aprovado. */
export async function verificarPagamento(r: Required<Pick<RetornoPagamento, 'orderNsu' | 'slug' | 'transactionNsu'>>): Promise<StatusPagamento> {
  const resp = await fetch(`${API}/payment_check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      handle: INFINITEPAY_HANDLE,
      order_nsu: r.orderNsu,
      transaction_nsu: r.transactionNsu,
      slug: r.slug,
    }),
  });
  const d: Record<string, unknown> = await resp.json().catch(() => ({}));
  return {
    pago: d.success === true && d.paid === true,
    valorPago: typeof d.paid_amount === 'number' ? d.paid_amount / 100 : undefined,
    metodo: typeof d.capture_method === 'string' ? d.capture_method : undefined,
  };
}

export function novoOrderNsu() {
  const agora = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const data = `${agora.getFullYear()}${p(agora.getMonth() + 1)}${p(agora.getDate())}-${p(agora.getHours())}${p(agora.getMinutes())}`;
  return `frete-${data}-${Math.random().toString(36).slice(2, 7)}`;
}
