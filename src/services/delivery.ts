// Delivery das lojas (vitrine): tipos e chamadas ao servidor (server/src/delivery.ts).
import type { CategoriaLoja, Veiculo } from '../data/servicos';
import { API, api } from './api';

export type Entrega = { ok: boolean; motivo?: string };
export type LojaVitrine = {
  id: string;
  nome: string;
  categoria: CategoriaLoja;
  descricao: string;
  temFoto: boolean;
  fotoV: string | null;
  aberta: boolean;
  pedidoMinimo: number;
  preparoMin: number;
  endereco: string;
  lat: number;
  lon: number;
  produtos: number;
  distanciaKm: number | null;
};
export type Produto = { id: string; nome: string; descricao: string; preco: number; categoria: string; temFoto: boolean; fotoV: string | null; ativo: boolean; ordem: number };
export type ItemPedido = { produtoId: string; nome: string; preco: number; qtd: number };
export type StatusPedido = 'pagamento_pendente' | 'aguardando_loja' | 'aceito' | 'entregue' | 'cancelado';
export type Pedido = {
  id: string;
  codigo: string;
  status: StatusPedido;
  rotulo: string;
  motivo: string | null;
  loja: { id: string; nome: string; temFoto: boolean };
  cliente: { nome: string; telefone: string | null } | null;
  itens: ItemPedido[];
  subtotal: number;
  frete: number;
  total: number;
  veiculo: Veiculo;
  observacao: string | null;
  entregaEndereco: string | null;
  checkoutUrl: string | null;
  pagamentoAte: string | null;
  metodo: string | null;
  criadoEm: string;
  pagoEm: string | null;
  aceitoEm: string | null;
  entregueEm: string | null;
  canceladoEm: string | null;
  liberadoEm: string | null;
  reembolso: number;
  reembolsadoEm: string | null;
  /** Taxa do Pix/cartão paga por cima do total (Pagar.me). */
  taxaPagamento: number;
  /** Taxa de serviço da MOVI sobre a entrega (embutida na entrega para o cliente). */
  taxaServico: number;
  aceiteAte: string | null;
  corridaId: string | null;
  corridaStatus: string | null;
  motorista: { nome: string; placa: string; carro: string; cor: string | null; veiculo: Veiculo } | null;
};
export type MinhaVitrine = {
  id: string;
  liberado: boolean;
  aprovada: boolean;
  mensalidade: number;
  diasMensalidade: number;
  ativaAte: string | null;
  ativa: boolean;
  aberta: boolean;
  descricao: string;
  categoria: CategoriaLoja;
  pedidoMinimo: number;
  preparoMin: number;
  pix: string;
  pixTipo?: string;
  temFoto: boolean;
  fotoV: string | null;
  aceiteMin: number;
  produtos: number;
  produtosAtivos: number;
  pedidosNovos: number;
  pedidosAndamento: number;
  saldo: SaldoLoja;
  /** Conta de recebimento na Pagar.me (as vendas caem direto nela quando ativa). */
  recebedor?: { temConta: boolean; status: string | null; ativo: boolean };
};
export type SaldoLoja = { disponivel: number; emAndamento: number; totalVendido: number; recebidoDireto?: number; proximoRepasseEm: string | null };
export type Repasse = { id: string; valor: number; status: 'solicitado' | 'pago' | 'recusado'; chavePix: string; criadoEm: string; pagoEm: string | null; motivo: string | null };
export type Vendas = SaldoLoja & { chavePix: string; pixTipo?: string; intervaloDias: number; vendas: { id: string; codigo: string; subtotal: number; liberadoEm: string }[]; repasses: Repasse[] };

export const fotoLoja = (l: { id: string; fotoV: string | null }) => `${API}/v2/lojas/${l.id}/foto?v=${l.fotoV ?? ''}`;
export const fotoProduto = (p: { id: string; fotoV: string | null }) => `${API}/v2/produtos/${p.id}/foto?v=${p.fotoV ?? ''}`;

// cliente
export const lojas = () => api<{ lojas: LojaVitrine[]; entrega: Entrega; moto: boolean }>('cliente', '/v2/lojas');
export const vitrine = (id: string) => api<{ loja: LojaVitrine; produtos: Produto[]; entrega: Entrega; moto: boolean }>('cliente', `/v2/lojas/${id}`);
export const cotarPedido = (lojaId: string, veiculo: Veiculo) =>
  api<{ frete: number; km: number; minutos: number; entrega: Entrega }>('cliente', '/v2/pedidos/cotar', { method: 'POST', corpo: { lojaId, veiculo } });
export const fazerPedido = (corpo: { lojaId: string; itens: { produtoId: string; qtd: number }[]; observacao: string; veiculo: Veiculo }) =>
  api<Pedido>('cliente', '/v2/pedidos', { method: 'POST', corpo });
export const pedido = (id: string) => api<Pedido>('cliente', `/v2/pedidos/${id}`);
export const pedidosAtivos = () => api<Pedido[]>('cliente', '/v2/pedidos/ativos');
export const cancelarPedido = (id: string) => api<Pedido>('cliente', `/v2/pedidos/${id}/cancelar`, { method: 'POST' });

// lojista
export const minhaVitrine = () => api<MinhaVitrine>('lojista', '/v2/loja');
export const salvarVitrine = (c: Partial<Pick<MinhaVitrine, 'descricao' | 'categoria' | 'pedidoMinimo' | 'preparoMin' | 'aberta'>>) => api('lojista', '/v2/loja', { method: 'PUT', corpo: c });
export const pagarMensalidade = () => api<{ id: string; valor: number; checkoutUrl: string }>('lojista', '/v2/loja/mensalidade', { method: 'POST' });
export const mensalidade = (id: string) => api<{ id: string; valor: number; status: string; checkoutUrl: string | null }>('lojista', `/v2/loja/mensalidades/${id}`);
export const meusProdutos = () => api<Produto[]>('lojista', '/v2/loja/produtos');
export const salvarProduto = (p: Partial<Omit<Produto, 'temFoto' | 'fotoV'>> & { foto?: string | null }) =>
  api<Produto>('lojista', p.id ? `/v2/loja/produtos/${p.id}` : '/v2/loja/produtos', { method: p.id ? 'PUT' : 'POST', corpo: p });
export const apagarProduto = (id: string) => api('lojista', `/v2/loja/produtos/${id}`, { method: 'DELETE' });
export const pedidosDaLoja = () => api<Pedido[]>('lojista', '/v2/loja/pedidos');
export const responderPedido = (id: string, acao: 'aceitar' | 'recusar', motivo?: string) =>
  api<Pedido>('lojista', `/v2/loja/pedidos/${id}/${acao}`, { method: 'POST', corpo: motivo ? { motivo } : {} });
export const vendas = () => api<Vendas>('lojista', '/v2/loja/saldo');
export const pedirRepasse = () => api<{ valor: number }>('lojista', '/v2/loja/repasses', { method: 'POST' });

/** Etapa do pedido para o cliente e a loja (inclui a entrega pelo motorista). */
export function etapaPedido(p: Pedido): string {
  if (p.status === 'aceito') {
    if (p.corridaStatus === 'em_andamento') return 'Saiu para entrega';
    if (p.corridaStatus === 'aceito' || p.corridaStatus === 'no_local') return p.motorista ? `${p.motorista.nome} indo buscar o pedido` : 'Motorista a caminho da loja';
    return 'Loja preparando · procurando motorista';
  }
  return p.rotulo;
}
