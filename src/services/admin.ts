import * as SecureStore from 'expo-secure-store';
import { API_PAGAMENTOS } from '../config';
import type { Tarifa, Urgencia } from './preco';

const CHAVE_SENHA = 'admin_token';

export type PedidoAdmin = {
  orderNsu: string;
  status: 'reservado' | 'pago' | 'cancelado' | 'concluido';
  valor: number;
  mercadoId: string;
  mercadoNome: string;
  agendado: boolean;
  inicio: string;
  fim: string;
  janela: string;
  expiraEm?: string;
  cliente: { nome: string; endereco: string; telefone?: string; lat: number; lon: number };
  criadoEm: string;
  pagoEm?: string;
  canceladoEm?: string;
  canceladoPor?: 'cliente' | 'admin';
  metodo?: string;
  receiptUrl?: string;
};

export type ConfigServidor = {
  aberto: boolean;
  bloqueioMin: number;
  passoMin: number;
  horaInicio: string;
  horaFim: string;
  antecedenciaMin: number;
  tarifas: Tarifa[];
  margem: number;
  urgencia: Urgencia;
};

export type StatusAdmin = { config: ConfigServidor; ocupadoAte: string | null; agora: { ok: boolean; motivo?: string } };

export class SemAcesso extends Error {}

export const lerSenha = () => SecureStore.getItemAsync(CHAVE_SENHA);
export const guardarSenha = (s: string) => SecureStore.setItemAsync(CHAVE_SENHA, s);
export const apagarSenha = () => SecureStore.deleteItemAsync(CHAVE_SENHA);

async function req<T>(caminho: string, init: RequestInit = {}, senha?: string): Promise<T> {
  const token = senha ?? (await lerSenha());
  if (!token || !API_PAGAMENTOS) throw new SemAcesso('Entre com a senha.');
  let r: Response;
  try {
    r = await fetch(`${API_PAGAMENTOS}/admin${caminho}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
    });
  } catch {
    throw new Error('Sem conexão com o servidor.');
  }
  if (r.status === 401) throw new SemAcesso('Senha incorreta.');
  const d = (await r.json().catch(() => ({}))) as T & { erro?: string };
  if (!r.ok) throw new Error(d.erro ?? 'Não foi possível concluir.');
  return d;
}

export async function entrar(senha: string) {
  await req<StatusAdmin>('/status', {}, senha);
  await guardarSenha(senha);
}

export const status = () => req<StatusAdmin>('/status');
export const pedidos = () => req<PedidoAdmin[]>('/pedidos');
export const estouLivre = () => req<{ ok: boolean }>('/livre', { method: 'POST' });
export const salvarConfig = (c: Partial<ConfigServidor>) => req<ConfigServidor>('/config', { method: 'PUT', body: JSON.stringify(c) });
export const concluir = (id: string) => req<PedidoAdmin>(`/pedidos/${id}/concluir`, { method: 'POST' });
export const cancelar = (id: string) => req<PedidoAdmin>(`/pedidos/${id}/cancelar`, { method: 'POST' });
export const linkAgenda = () => req<{ url: string }>('/agenda-link');
export const testarWhatsapp = () => req<{ ok: boolean }>('/whatsapp-teste', { method: 'POST' });
