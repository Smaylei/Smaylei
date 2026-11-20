/** InfiniteTag da conta que recebe os pagamentos (sem o "$"). Não é senha. */
export const INFINITEPAY_HANDLE = 'smayleiluiz';

/**
 * Página https para onde a InfinitePay manda o cliente após pagar. A InfinitePay só aceita
 * endereços https (recusa "mercadofrete://"), então esta página precisa existir num servidor e
 * reabrir o app com os parâmetros recebidos. Enquanto for null, o checkout abre sem retorno e a
 * confirmação fica com o comprovante que o cliente recebe da InfinitePay.
 */
export const URL_RETORNO_PAGAMENTO: string | null = null;
