// Cliente da API do servidor (server/src/central.ts), usado pelos três apps.
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as SecureStore from 'expo-secure-store';
import { API_PAGAMENTOS } from '../config';

export const API = API_PAGAMENTOS ?? '';

export type Papel = 'cliente' | 'motorista' | 'admin';
const CHAVE: Record<Papel, string> = { cliente: 'token_cliente', motorista: 'token_motorista', admin: 'admin_token' };

export const lerToken = (p: Papel) => SecureStore.getItemAsync(CHAVE[p]);
export const guardarToken = (p: Papel, t: string) => SecureStore.setItemAsync(CHAVE[p], t);
export const apagarToken = (p: Papel) => SecureStore.deleteItemAsync(CHAVE[p]);

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
export async function enviarFoto(papel: 'cliente' | 'motorista', tipo: 'foto' | 'selfie' | 'cnh', uri: string) {
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

export type Status = 'buscando' | 'aceito' | 'aguardando_pagamento' | 'pago' | 'entregue' | 'cancelado';

export type MotoristaPublico = {
  id: string;
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

export type CorridaCliente = {
  id: string;
  status: Status;
  agendado: boolean;
  janela: string;
  inicio: string;
  mercadoId: string;
  mercadoNome: string;
  valor: number;
  taxaIncluida: number;
  valorCobrado: number;
  checkoutUrl: string | null;
  receiptUrl?: string;
  metodo?: string;
  motivo?: string;
  taxaAplicada: number;
  criadoEm: string;
  chegouEm?: string;
  pagoEm?: string;
  esperaPagamentoMin: number;
  motorista: MotoristaPublico | null;
};

export type CorridaMotorista = {
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
  valor: number;
  ganho: number;
  chegouEm?: string;
  pagoEm?: string;
  kmAteMercado?: number | null;
  ofertaAte?: string;
};

export type Mensagem = { id: number; autor: 'cliente' | 'motorista'; texto: string; criadoEm: string };

export type Disponibilidade = {
  agora: { ok: boolean; motivo?: string };
  dias: { data: string; rotulo: string; horarios: { inicio: string; hora: string }[] }[];
  bloqueioMin: number;
};

export const ROTULO_STATUS: Record<Status, string> = {
  buscando: 'Procurando motorista',
  aceito: 'Motorista a caminho do mercado',
  aguardando_pagamento: 'Motorista no mercado — pague para começar',
  pago: 'Pago — compras a caminho',
  entregue: 'Entregue',
  cancelado: 'Cancelado',
};
