import type { ServicoId, Veiculo } from '../data/servicos';
// Cliente da API do servidor (server/src/central.ts), usado pelos três apps.
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { API_PAGAMENTOS } from '../config';

export const API = API_PAGAMENTOS ?? '';

export type Papel = 'cliente' | 'motorista' | 'lojista' | 'admin';
const CHAVE: Record<Papel, string> = { cliente: 'token_cliente', motorista: 'token_motorista', lojista: 'token_lojista', admin: 'admin_token' };

// No navegador (painel Admin web) não há SecureStore: guarda no navegador do computador.
const web = Platform.OS === 'web';
export const lerToken = async (p: Papel) => (web ? (globalThis.localStorage?.getItem(CHAVE[p]) ?? null) : SecureStore.getItemAsync(CHAVE[p]));
export const guardarToken = async (p: Papel, t: string) => (web ? globalThis.localStorage?.setItem(CHAVE[p], t) : SecureStore.setItemAsync(CHAVE[p], t));
export const apagarToken = async (p: Papel) => (web ? globalThis.localStorage?.removeItem(CHAVE[p]) : SecureStore.deleteItemAsync(CHAVE[p]));

export class ErroApi extends Error {
  constructor(
    msg: string,
    public status = 0,
  ) {
    super(msg);
  }
}

export async function api<T>(papel: Papel | null, caminho: string, init: RequestInit & { corpo?: unknown } = {}): Promise<T> {
  const token = papel ? await lerToken(papel) : null;
  if (papel && !token) throw new ErroApi('Faça o cadastro ou entre novamente.', 401);
  const { corpo, ...resto } = init;
  let r: Response;
  try {
    r = await fetch(`${API}${caminho}`, {
      ...resto,
      body: corpo !== undefined ? JSON.stringify(corpo) : resto.body,
      headers: {
        ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(resto.headers ?? {}),
      },
    });
  } catch {
    throw new ErroApi('Sem conexão. Verifique a internet.');
  }
  const d = (await r.json().catch(() => ({}))) as T & { erro?: string };
  if (!r.ok) throw new ErroApi(d.erro ?? 'Não foi possível concluir agora.', r.status);
  return d;
}

/** Diminui a foto (máx. 1280 px) e envia ao servidor. */
export async function enviarFoto(papel: 'cliente' | 'motorista' | 'lojista', tipo: 'foto' | 'selfie' | 'cnh' | 'produto', uri: string) {
  const ctx = ImageManipulator.manipulate(uri);
  ctx.resize({ width: 1280 });
  const img = await (await ctx.renderAsync()).saveAsync({ compress: 0.6, format: SaveFormat.JPEG });
  const dados = await (await fetch(img.uri)).blob();
  return api<{ chave: string }>(papel, `/v2/arquivos?tipo=${tipo}`, { method: 'POST', body: dados, headers: { 'Content-Type': 'image/jpeg' } });
}

/** Endereço da imagem com o token (o componente Image envia cabeçalhos). */
export async function fonteImagem(papel: Papel, caminho: string) {
  const token = await lerToken(papel);
  return { uri: `${API}${caminho}`, headers: token ? { Authorization: `Bearer ${token}` } : undefined };
}

// ---------- tipos ----------

export type Status = 'pagamento_pendente' | 'buscando' | 'aceito' | 'no_local' | 'em_andamento' | 'entregue' | 'cancelado';

export type MotoristaPublico = {
  id: string;
  veiculo?: Veiculo;
  nome: string;
  carro: string;
  placa: string;
  cor?: string;
  temFoto: boolean;
  lat?: number;
  lon?: number;
  locEm?: string;
  telefone?: string;
};

export type PontoViagem = { nome: string; endereco: string; lat: number; lon: number };

/** Serviço, coleta e destino (iguais para cliente, motorista e admin). */
export type Viagem = {
  servico: ServicoId;
  servicoTitulo: string;
  /** Carro ou moto (motoboy). */
  veiculo?: Veiculo;
  /** Km cobrados do motorista até a coleta. */
  kmDesloc?: number | null;
  descricao: string | null;
  /** O cliente está na coleta (confirma a chegada do motorista)? Senão, confirma o recebimento. */
  clienteNaColeta: boolean;
  /** Leva e traz (borracharia). */
  retorno: boolean;
  chegouDestinoEm: string | null;
  coleta: PontoViagem;
  entrega: PontoViagem;
};

export type CorridaCliente = Viagem & {
  id: string;
  status: Status;
  agendado: boolean;
  janela: string;
  inicio: string;
  mercadoId: string;
  mercadoNome: string;
  valor: number;
  checkoutUrl: string | null;
  pagamentoAte?: string;
  receiptUrl?: string;
  metodo?: string;
  motivo?: string;
  taxaAplicada: number;
  reembolso: number;
  reembolsadoEm?: string;
  criadoEm: string;
  pagoEm?: string;
  chegouEm?: string;
  liberadoEm?: string;
  entregueEm?: string;
  esperaConfirmacaoMin: number;
  taxaDeslocamento: number;
  motorista: MotoristaPublico | null;
  mensagens: number;
  /** Nota que o cliente deu (1–5) ou null se ainda não avaliou. */
  avaliacao: number | null;
  /** Gorjeta paga neste frete. */
  gorjeta: number | null;
  /** Várias viagens pagas de uma vez. */
  pacote: { id: string; valor: number; viagens: number } | null;
  /** Entrega de um pedido do delivery (cancelamento só pelo suporte). */
  pedidoId?: string | null;
  /** Pagar.me: pedido para agora é pago quando o motorista aceita. */
  pagarAoAceitar?: boolean;
  aguardandoPagamento?: boolean;
};

export type CorridaMotorista = Viagem & {
  id: string;
  status: Status;
  agendado: boolean;
  janela: string;
  inicio: string;
  fim: string;
  mercado: { id: string; nome: string; endereco: string; lat: number; lon: number } | null;
  cliente: { nome: string; telefone: string | null; endereco: string; lat: number; lon: number } | null;
  km: number;
  minutos: number;
  /** Para o motorista, igual ao ganho (ele não vê o valor pago pelo cliente). */
  valor: number;
  ganho: number;
  /** Extra do pedido "agora" (já somado ao ganho). */
  incentivo?: number;
  /** Pagar.me: aceitou, mas o cliente ainda não pagou (não sair ainda). */
  aguardandoPagamento?: boolean;
  pagamentoAte?: string | null;
  /** Ganho pago direto na conta Pagar.me do motorista (split). */
  repasseDireto?: boolean;
  gorjeta: number | null;
  chegouEm?: string;
  liberadoEm?: string;
  esperaConfirmacaoMin: number;
  raioChegadaM: number;
  taxaDeslocamento: number;
  kmAteMercado?: number | null;
  ofertaAte?: string;
};

export type Saldo = {
  disponivel: number;
  emLiberacao: number;
  totalGanho: number;
  /** Recebido direto na conta Pagar.me (split), fora do saldo de saque. */
  recebidoDireto?: number;
  proximoSaqueEm: string | null;
};

export type Mensagem = { id: number; autor: 'cliente' | 'motorista' | 'suporte'; texto: string; criadoEm: string };

export type Disponibilidade = {
  agora: { ok: boolean; motivo?: string };
  dias: { data: string; rotulo: string; horarios: { inicio: string; hora: string }[] }[];
  bloqueioMin: number;
};

export const ROTULO_STATUS: Record<Status, string> = {
  pagamento_pendente: 'Aguardando pagamento',
  buscando: 'Pago · procurando motorista',
  aceito: 'Motorista a caminho da coleta',
  no_local: 'Motorista no local da coleta',
  em_andamento: 'A caminho da entrega',
  entregue: 'Entregue',
  cancelado: 'Cancelado',
};

export type Gorjeta = { id: string; corridaId?: string; valor: number; status: 'pendente' | 'paga' | 'cancelada'; checkoutUrl: string | null };
