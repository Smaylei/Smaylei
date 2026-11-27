// Pagar.me (API v5): pedidos com Pix e cartão, split entre recebedores, estorno e recebedores (lojas
// e motoristas) com prova de vida (KYC). Documentação: https://docs.pagar.me (llms.txt).
//
// A chave secreta (sk_...) fica só como segredo do Worker (PAGARME_SECRET_KEY); o app usa apenas a
// chave pública (pk_...) para gerar o token do cartão direto na Pagar.me. Valores sempre em centavos.

export type SplitRegra = { recebedor: string; centavos: number; principal: boolean };
export type ItemCobranca = { codigo: string; descricao: string; centavos: number; qtd: number };
export type ClienteCobranca = { nome: string; cpf?: string | null; telefone?: string | null };
export type ResultadoPedido = {
  orderId: string;
  chargeId: string | null;
  status: 'paid' | 'pending' | 'failed' | 'canceled' | string;
  qrCode: string | null;
  qrCodeUrl: string | null;
  expiraEm: string | null;
  metodo: 'pix' | 'cartao';
  motivoFalha: string | null;
};

const base = (chave: string) => (chave.startsWith('sk_test_') ? 'https://sdx-api.pagar.me/core/v5' : 'https://api.pagar.me/core/v5');
const so = (s: unknown) => String(s ?? '').replace(/\D/g, '');

async function chamar<T>(chave: string, metodo: string, caminho: string, corpo?: unknown): Promise<T> {
  const r = await fetch(base(chave) + caminho, {
    method: metodo,
    headers: { authorization: 'Basic ' + btoa(chave + ':'), 'content-type': 'application/json', accept: 'application/json', 'user-agent': 'MOVI/1.0' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  }).catch(() => null);
  if (!r) throw new Error('Sem conexão com a Pagar.me. Tente de novo.');
  const d = (await r.json().catch(() => ({}))) as T & { message?: string; errors?: Record<string, string[]> | { message?: string }[] };
  if (!r.ok) {
    const det = Array.isArray(d.errors) ? d.errors.map((e) => e.message).filter(Boolean).join(' ') : d.errors ? Object.values(d.errors).flat().join(' ') : '';
    throw new Error(`Pagar.me: ${d.message ?? 'erro'}${det ? ` (${det})` : ''}`);
  }
  return d;
}

type Charge = { id: string; status: string; payment_method?: string; last_transaction?: { status?: string; qr_code?: string; qr_code_url?: string; expires_at?: string; acquirer_message?: string; gateway_response?: { errors?: { message?: string }[] } } };
type Order = { id: string; status: string; charges?: Charge[] };

function cliente(c: ClienteCobranca) {
  const tel = so(c.telefone).replace(/^55(?=\d{10,11}$)/, '');
  return {
    name: c.nome.slice(0, 64),
    type: 'individual',
    ...(so(c.cpf).length === 11 ? { document: so(c.cpf), document_type: 'CPF' } : {}),
    ...(tel.length >= 10 ? { phones: { mobile_phone: { country_code: '55', area_code: tel.slice(0, 2), number: tel.slice(2) } } } : {}),
  };
}

function resultado(o: Order, metodo: 'pix' | 'cartao'): ResultadoPedido {
  const ch = o.charges?.[0];
  const t = ch?.last_transaction;
  const pago = o.status === 'paid' || ch?.status === 'paid';
  return {
    orderId: o.id,
    chargeId: ch?.id ?? null,
    status: pago ? 'paid' : ch?.status === 'failed' || o.status === 'failed' ? 'failed' : ch?.status === 'canceled' || o.status === 'canceled' ? 'canceled' : 'pending',
    qrCode: t?.qr_code ?? null,
    qrCodeUrl: t?.qr_code_url ?? null,
    expiraEm: t?.expires_at ?? null,
    metodo,
    motivoFalha: pago ? null : (t?.acquirer_message ?? t?.gateway_response?.errors?.[0]?.message ?? null),
  };
}

/** Cria o pedido (uma cobrança) com Pix ou cartão (token gerado no app) e, se houver, o split. */
export async function criarPedido(
  chave: string,
  o: {
    codigo: string;
    itens: ItemCobranca[];
    cliente: ClienteCobranca;
    metodo: 'pix' | 'cartao';
    pixExpiraSeg?: number;
    cardToken?: string;
    cobranca?: { endereco: string; cep: string; cidade: string; uf: string };
    split?: SplitRegra[];
    descricaoFatura?: string;
  },
): Promise<ResultadoPedido> {
  const pagamento: Record<string, unknown> =
    o.metodo === 'pix'
      ? { payment_method: 'pix', pix: { expires_in: Math.max(60, Math.round(o.pixExpiraSeg ?? 900)) } }
      : {
          payment_method: 'credit_card',
          credit_card: {
            installments: 1, // só à vista
            statement_descriptor: (o.descricaoFatura ?? 'MOVI').slice(0, 13),
            card_token: o.cardToken,
            card: o.cobranca
              ? { billing_address: { line_1: o.cobranca.endereco.slice(0, 120), zip_code: so(o.cobranca.cep), city: o.cobranca.cidade, state: o.cobranca.uf, country: 'BR' } }
              : undefined,
          },
        };
  if (o.split?.length)
    pagamento.split = o.split.map((s) => ({
      amount: s.centavos,
      recipient_id: s.recebedor,
      type: 'flat',
      // A MOVI (principal) paga as taxas, fica com o restante e responde por chargeback.
      options: { charge_processing_fee: s.principal, charge_remainder_fee: s.principal, liable: s.principal },
    }));
  const corpo = {
    code: o.codigo,
    closed: true,
    items: o.itens.map((i) => ({ code: i.codigo.slice(0, 52), description: i.descricao.slice(0, 120), amount: i.centavos, quantity: i.qtd })),
    customer: cliente(o.cliente),
    payments: [pagamento],
  };
  return resultado(await chamar<Order>(chave, 'POST', '/orders', corpo), o.metodo);
}

export async function obterPedido(chave: string, orderId: string, metodo: 'pix' | 'cartao'): Promise<ResultadoPedido> {
  return resultado(await chamar<Order>(chave, 'GET', `/orders/${encodeURIComponent(orderId)}`), metodo);
}

/** Estorna a cobrança (total, ou parte do valor). Pix e cartão usam o mesmo cancelamento. */
export async function estornar(chave: string, chargeId: string, centavos?: number) {
  const ch = await chamar<Charge>(chave, 'DELETE', `/charges/${encodeURIComponent(chargeId)}`, centavos ? { amount: centavos } : {});
  return ch.status;
}

// ---------- recebedores (lojas e motoristas) ----------
export type Endereco = { rua: string; numero: string; complemento?: string; bairro: string; cidade: string; uf: string; cep: string; referencia?: string };
export type ContaBancaria = { banco: string; agencia: string; agenciaDv?: string; conta: string; contaDv: string; tipo: 'checking' | 'savings'; titular: string; documentoTitular: string };
export type DadosRecebedor = {
  codigo: string;
  tipo: 'individual' | 'corporation';
  email: string;
  documento: string;
  telefone: string;
  endereco: Endereco;
  conta: ContaBancaria;
  // pessoa física (motorista, loja sem CNPJ) — ou o responsável legal da empresa
  nome: string;
  nascimento: string; // AAAA-MM-DD
  rendaMensal: number; // R$
  profissao: string;
  nomeMae?: string;
  // pessoa jurídica (loja com CNPJ)
  razaoSocial?: string;
  nomeFantasia?: string;
  faturamentoAnual?: number; // R$
  fundacao?: string; // AAAA-MM-DD
  cpfResponsavel?: string;
};

function endereco(e: Endereco) {
  return {
    street: e.rua, complementary: e.complemento?.trim() || 'Sem complemento', street_number: e.numero, neighborhood: e.bairro,
    city: e.cidade, state: e.uf.toUpperCase(), zip_code: so(e.cep), reference_point: e.referencia?.trim() || 'Sem referência',
  };
}

/** Monta o cadastro do recebedor (contrato v5 com register_information, Circular 3.978/20). */
export function corpoRecebedor(d: DadosRecebedor) {
  const tel = so(d.telefone).replace(/^55(?=\d{10,11}$)/, '');
  const telefones = [{ ddd: tel.slice(0, 2), number: tel.slice(2), type: 'mobile' }];
  const pf = {
    name: d.nome, email: d.email, document: so(d.cpfResponsavel ?? d.documento), type: 'individual', mother_name: d.nomeMae || undefined,
    birthdate: `${d.nascimento}T00:00:00`, monthly_income: Math.round(d.rendaMensal * 100), professional_occupation: d.profissao,
    address: endereco(d.endereco), phone_numbers: telefones,
  };
  const register_information =
    d.tipo === 'individual'
      ? { ...pf, document: so(d.documento), site_url: 'https://movi.com.br' }
      : {
          company_name: d.nomeFantasia ?? d.razaoSocial, trading_name: d.razaoSocial ?? d.nomeFantasia, email: d.email, document: so(d.documento), type: 'corporation',
          site_url: 'https://movi.com.br', annual_revenue: Math.round((d.faturamentoAnual ?? 0) * 100), founding_date: d.fundacao,
          main_address: endereco(d.endereco), phone_numbers: telefones, managing_partners: [{ ...pf, self_declared_legal_representative: true }],
        };
  return {
    code: d.codigo,
    register_information,
    default_bank_account: {
      holder_name: d.conta.titular.slice(0, 30), holder_type: so(d.conta.documentoTitular).length === 14 ? 'company' : 'individual', holder_document: so(d.conta.documentoTitular),
      bank: so(d.conta.banco).padStart(3, '0'), branch_number: so(d.conta.agencia), branch_check_digit: so(d.conta.agenciaDv) || undefined,
      account_number: so(d.conta.conta), account_check_digit: so(d.conta.contaDv), type: d.conta.tipo,
    },
    // Repasse automático da Pagar.me para a conta bancária, toda semana.
    transfer_settings: { transfer_enabled: true, transfer_interval: 'Weekly', transfer_day: 5 },
  };
}

export async function criarRecebedor(chave: string, d: DadosRecebedor) {
  const r = await chamar<{ id: string; status: string }>(chave, 'POST', '/recipients', corpoRecebedor(d));
  return { id: r.id, status: r.status };
}
export async function obterRecebedor(chave: string, id: string) {
  const r = await chamar<{ id: string; status: string }>(chave, 'GET', `/recipients/${encodeURIComponent(id)}`);
  return { id: r.id, status: r.status };
}
/** Link (e QR) da prova de vida da Pagar.me, que a própria pessoa abre no celular. */
export async function linkKyc(chave: string, id: string) {
  const r = await chamar<{ url: string; expires_at?: string }>(chave, 'POST', `/recipients/${encodeURIComponent(id)}/kyc_link`, {});
  return { url: r.url.startsWith('http') ? r.url : `https://${r.url}`, expiraEm: r.expires_at ?? null };
}
