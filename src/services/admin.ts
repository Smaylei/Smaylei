// Chamadas do App Admin (rotas /v2/admin no servidor). A senha é o ADMIN_TOKEN da Cloudflare.
import { api, apagarToken, guardarToken, type Disponibilidade, type Status } from './api';
import type { Tarifa, Urgencia } from './preco';

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
  comissaoMotoristaPct: number;
  taxaDeslocamento: number;
  esperaPagamentoMin: number;
  ofertaMin: number;
};

export type Resumo = {
  config: ConfigServidor;
  disponibilidade: Disponibilidade;
  motoristasOnline: number;
  motoristasPendentes: number;
  corridasAtivas: number;
  aRepassar: number;
  faturamentoHoje: number;
};

export type CorridaAdmin = {
  id: string;
  status: Status;
  agendado: number;
  inicio: string;
  fim: string;
  janela: string;
  mercado_nome: string;
  valor: number;
  valor_cobrado: number | null;
  taxa_incluida: number;
  ganho_motorista: number | null;
  metodo: string | null;
  motivo: string | null;
  cancelado_por: string | null;
  taxa_aplicada: number;
  criado_em: string;
  pago_em: string | null;
  cliente_nome: string;
  cliente_telefone: string | null;
  cliente_endereco: string;
  cliente_lat: number;
  cliente_lon: number;
  motorista_nome: string | null;
  motorista_placa: string | null;
  motorista_telefone: string | null;
};

export type MotoristaAdmin = {
  id: string;
  nome: string;
  cpf: string;
  telefone: string;
  carro: string;
  placa: string;
  cor: string | null;
  pix: string | null;
  status: 'pendente' | 'aprovado' | 'bloqueado';
  online: number;
  loc_em: string | null;
  criado_em: string;
  selfie: string | null;
  cnh: string | null;
  a_repassar: number;
  corridas: number;
};

export type ClienteAdmin = {
  id: string;
  nome: string;
  cpf: string;
  telefone: string | null;
  endereco: string;
  taxa_pendente: number;
  bloqueado: number;
  criado_em: string;
  foto: string | null;
  corridas: number;
};

export async function entrar(senha: string) {
  await guardarToken('admin', senha);
  try {
    await resumo();
  } catch (e) {
    await apagarToken('admin');
    throw e;
  }
}
export const sair = () => apagarToken('admin');

export const resumo = () => api<Resumo>('admin', '/v2/admin/resumo');
export const corridas = () => api<CorridaAdmin[]>('admin', '/v2/admin/corridas');
export const motoristas = () => api<MotoristaAdmin[]>('admin', '/v2/admin/motoristas');
export const clientes = () => api<ClienteAdmin[]>('admin', '/v2/admin/clientes');
export const salvarConfig = (c: Partial<ConfigServidor>) => api<ConfigServidor>('admin', '/v2/admin/config', { method: 'PUT', corpo: c });
export const statusMotorista = (id: string, status: MotoristaAdmin['status']) =>
  api('admin', `/v2/admin/motoristas/${id}/status`, { method: 'POST', corpo: { status } });
export const repasseFeito = (id: string) => api<{ valor: number; corridas: number }>('admin', `/v2/admin/motoristas/${id}/repasse`, { method: 'POST' });
export const acaoCliente = (id: string, acao: 'bloquear' | 'desbloquear' | 'zerar-taxa') => api('admin', `/v2/admin/clientes/${id}/${acao}`, { method: 'POST' });
export const cancelarCorrida = (id: string) => api('admin', `/v2/admin/corridas/${id}/cancelar`, { method: 'POST' });
export const linkAgenda = () => api<{ url: string }>('admin', '/v2/admin/agenda-link');
export const testarWhatsapp = () => api<{ ok: boolean }>('admin', '/v2/admin/whatsapp-teste', { method: 'POST' });
export const arquivo = (chave: string) => `/v2/admin/arquivo?chave=${encodeURIComponent(chave)}`;
