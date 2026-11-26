/** InfiniteTag da conta que recebe os pagamentos (sem o "$"). Não é senha. */
export const INFINITEPAY_HANDLE = 'smayleiluiz';

/**
 * Página https para onde a InfinitePay manda o cliente após pagar. A InfinitePay só aceita
 * endereços https (recusa "mercadofrete://"), então esta página precisa existir num servidor e
 * reabrir o app com os parâmetros recebidos. Enquanto for null, o checkout abre sem retorno e a
 * confirmação fica com o comprovante que o cliente recebe da InfinitePay.
 */
export const URL_RETORNO_PAGAMENTO: string | null = null;

/**
 * Endereço do servidor de pagamentos (pasta server/, Cloudflare Worker), ex.:
 * "https://mercado-frete-pagamentos.<sua-conta>.workers.dev". Com ele o valor é recalculado no
 * servidor, o link vale para um único pagamento e o app recebe a confirmação automática.
 * Enquanto for null, o app gera o link direto na InfinitePay (sem confirmação automática).
 */
export const API_PAGAMENTOS: string | null = 'https://mercado-frete-pagamentos.mercado-frete-pagamentos.workers.dev';

/** Painel Admin (só no navegador do computador). */
export const ADMIN_WEB = 'https://movi-admin.mercado-frete-pagamentos.workers.dev';
