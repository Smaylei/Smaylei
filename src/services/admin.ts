import type { CidadeId } from '../data/cidades';
import type { CategoriaId, ServicoId } from '../data/servicos';
// Chamadas do App Admin (rotas /v2/admin no servidor). A senha é o ADMIN_TOKEN da Cloudflare.
import { Alert } from 'react-native';
import { api, apagarToken, guardarToken, type Disponibilidade, type Status } from './api';
import type { Tarifa, Urgencia } from './preco';
import type { LojaVitrine, Pedido, SaldoLoja } from './delivery';

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
  esperaConfirmacaoMin: number;
  raioChegadaM: number;
  ofertaMin: number;
  saqueDias: number;
  esperaBorrachariaMin: number;
  servicosAtivos: ServicoId[];
  categoriasAtivas: CategoriaId[];
  outroEnderecoLoja: boolean;
  cidadesAtivas: CidadeId[];
  motoAtivo: boolean;
  motoServicos: ServicoId[];
  motoMinimo: number;
  motoKmIncluso: number;
  motoPorKm: number;
  motoRepassePct: number;
  deslocamentoPadraoKm: number;
  deslocamentoMaxKm: number;
  deliveryMensalidade: number;
  deliveryUrgencia: boolean;
  deliveryAceiteMin: number;
};

export type Resumo = {
  config: ConfigServidor;
  disponibilidade: Disponibilidade;
  motoristasOnline: number;
  motoristasPendentes: number;
  corridasAtivas: number;
  retido: number;
  saquesPendentes: number;
  saquesPendentesQtd: number;
  estornosPendentes: number;
  estornosPendentesQtd: number;
  avisosNaoLidos: number;
  lojistasPendentes: number;
  avaliacoesNaoLidas: number;
  notaMedia: number;
  gorjetasHoje: number;
  faturamentoHoje: number;
  deliveryPedidosAbertos: number;
  deliveryRetido: number;
  repassesLojaPendentes: number;
  repassesLojaPendentesQtd: number;
};

export type CorridaAdmin = {
  id: string;
  status: Status;
  motorista_id: string | null;
  coleta_lat: number | null;
  coleta_lon: number | null;
  agendado: number;
  inicio: string;
  fim: string;
  janela: string;
  mercado_nome: string;
  servico: string | null;
  descricao: string | null;
  coleta_nome: string | null;
  coleta_endereco: string | null;
  entrega_nome: string | null;
  entrega_endereco: string | null;
  entrega_lat: number | null;
  entrega_lon: number | null;
  pacote_id: string | null;
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
  liberado_em: string | null;
  reembolso: number;
  reembolsado_em: string | null;
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
  veiculo?: 'carro' | 'moto';
  nome: string;
  cpf: string;
  telefone: string;
  carro: string;
  placa: string;
  cor: string | null;
  status: 'pendente' | 'aprovado' | 'bloqueado';
  online: number;
  lat: number | null;
  lon: number | null;
  loc_em: string | null;
  criado_em: string;
  selfie: string | null;
  cnh: string | null;
  corridas: number;
  disponivel: number;
  emLiberacao: number;
  totalGanho: number;
};

export type ClienteAdmin = {
  id: string;
  nome: string;
  cpf: string;
  telefone: string | null;
  endereco: string;
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
export const acaoCliente = (id: string, acao: 'bloquear' | 'desbloquear') => api('admin', `/v2/admin/clientes/${id}/${acao}`, { method: 'POST' });

export type SaqueAdmin = {
  id: string;
  motorista_id: string;
  motorista_nome: string;
  motorista_telefone: string;
  valor: number;
  chave_pix: string;
  status: 'solicitado' | 'pago' | 'recusado';
  criado_em: string;
  pago_em: string | null;
  motivo: string | null;
};
export type EstornoAdmin = {
  id: string;
  valor: number;
  reembolso: number;
  reembolsado_em: string | null;
  motivo: string | null;
  cancelado_em: string | null;
  receipt_url: string | null;
  metodo: string | null;
  mercado_nome: string;
  taxa_aplicada: number;
  cliente_nome: string;
  cliente_telefone: string | null;
};
export const saques = () => api<SaqueAdmin[]>('admin', '/v2/admin/saques');
export const pagarSaque = (id: string) => api('admin', `/v2/admin/saques/${id}/pagar`, { method: 'POST' });
export const recusarSaque = (id: string, motivo: string) => api('admin', `/v2/admin/saques/${id}/recusar`, { method: 'POST', corpo: { motivo } });
export const estornos = () => api<EstornoAdmin[]>('admin', '/v2/admin/estornos');
export const estornoFeito = (id: string) => api('admin', `/v2/admin/estornos/${id}/feito`, { method: 'POST' });
export const cancelarCorrida = (id: string) => api('admin', `/v2/admin/corridas/${id}/cancelar`, { method: 'POST' });
export const linkAgenda = () => api<{ url: string }>('admin', '/v2/admin/agenda-link');
export type Aviso = { id: number; texto: string; corridaId: string | null; criadoEm: string; lido: number };
export const avisos = () => api<{ naoLidos: number; avisos: Aviso[] }>('admin', '/v2/admin/avisos');
export const avisosLidos = () => api('admin', '/v2/admin/avisos/lidos', { method: 'POST' });
export const arquivo = (chave: string) => `/v2/admin/arquivo?chave=${encodeURIComponent(chave)}`;

export type AvaliacaoAdmin = {
  corridaId: string;
  nota: number;
  sugestao: string | null;
  criadoEm: string;
  lida: number;
  clienteNome: string;
  motoristaNome: string | null;
  mercado: string;
  valor: number;
  gorjeta: number | null;
};
export type Avaliacoes = { media: number | null; total: number; comSugestao: number; gorjetas: { total: number; quantidade: number }; avaliacoes: AvaliacaoAdmin[] };
export const avaliacoes = () => api<Avaliacoes>('admin', '/v2/admin/avaliacoes');
export const avaliacoesLidas = () => api('admin', '/v2/admin/avaliacoes/lidas', { method: 'POST' });

export type LocalAdmin = { id: string; categoria: string; nome: string; endereco: string; lat: number; lon: number; ativo: boolean; cidade?: CidadeId | null };
export const locais = () => api<LocalAdmin[]>('admin', '/v2/admin/locais');
export const salvarLocal = (l: Partial<LocalAdmin>) =>
  api<LocalAdmin>('admin', l.id ? `/v2/admin/locais/${l.id}` : '/v2/admin/locais', { method: l.id ? 'PUT' : 'POST', corpo: l });
export const apagarLocal = (id: string) => api('admin', `/v2/admin/locais/${id}`, { method: 'DELETE' });

export type LojistaAdmin = {
  id: string; nome: string; cpf: string; telefone: string | null; endereco: string; lat: number; lon: number;
  loja_nome: string; cnpj: string | null; status: 'pendente' | 'aprovado' | 'bloqueado'; criado_em: string; corridas: number;
};
export const lojistas = () => api<LojistaAdmin[]>('admin', '/v2/admin/lojistas');
export const statusLojista = (id: string, status: LojistaAdmin['status']) => api('admin', `/v2/admin/lojistas/${id}/status`, { method: 'POST', corpo: { status } });

/** Gera uma senha provisória (6 números) para a pessoa entrar e depois trocar em "Minha conta". */
export async function senhaProvisoria(tipo: 'clientes' | 'motoristas' | 'lojistas', id: string, nome: string) {
  const ok = await new Promise<boolean>((res) =>
    Alert.alert('Senha provisória', `Gerar uma senha provisória para ${nome}? A senha atual deixa de valer.`, [
      { text: 'Voltar', style: 'cancel', onPress: () => res(false) },
      { text: 'Gerar', onPress: () => res(true) },
    ]),
  );
  if (!ok) return;
  try {
    const r = await api<{ senha: string }>('admin', `/v2/admin/${tipo}/${id}/senha`, { method: 'POST' });
    Alert.alert('Senha provisória', `${nome}: ${r.senha}\n\nPasse para a pessoa entrar com o CPF${tipo === 'lojistas' ? ' ou CNPJ' : ''} e essa senha, e depois trocar em "Minha conta".`);
  } catch (e) {
    Alert.alert('Erro', (e as Error).message);
  }
}

/** Exclui a conta (depois de confirmar). O histórico de corridas e pagamentos fica como "conta excluída". */
export async function excluirConta(tipo: 'clientes' | 'motoristas' | 'lojistas', id: string, nome: string, depois: () => void) {
  const ok = await new Promise<boolean>((res) =>
    Alert.alert(
      'Excluir conta',
      `Excluir a conta de ${nome}? Isso não pode ser desfeito. A pessoa sai do app e pode fazer um cadastro novo com o mesmo CPF.`,
      [
        { text: 'Voltar', style: 'cancel', onPress: () => res(false) },
        { text: 'Excluir', style: 'destructive', onPress: () => res(true) },
      ],
    ),
  );
  if (!ok) return;
  try {
    await api('admin', `/v2/admin/${tipo}/${id}`, { method: 'DELETE' });
    depois();
  } catch (e) {
    Alert.alert('Não foi possível excluir', (e as Error).message);
  }
}

// ---------- delivery das lojas ----------
export type LojaDeliveryAdmin = LojaVitrine & {
  status: 'aprovado' | 'bloqueado';
  ativaAte: string | null;
  ativa: boolean;
  pix: string;
  telefone: string;
  responsavel: string;
  saldo: SaldoLoja;
  pedidos: number;
  produtosTotal: number;
};
export type RepasseLojaAdmin = { id: string; loja_id: string; loja_nome: string; telefone: string | null; valor: number; chave_pix: string; status: 'solicitado' | 'pago' | 'recusado'; criado_em: string; pago_em: string | null; motivo: string | null };
export type MensalidadeAdmin = { id: string; valor: number; dias: number; origem: 'pagamento' | 'cortesia'; metodo: string | null; pagoEm: string; loja: string };
export type DeliveryAdmin = { liberado: boolean; lojas: LojaDeliveryAdmin[]; repasses: RepasseLojaAdmin[]; pedidos: Pedido[]; mensalidades: MensalidadeAdmin[] };
export const delivery = () => api<DeliveryAdmin>('admin', '/v2/admin/delivery');
export const diasVitrine = (id: string, dias: number) => api<{ ativaAte: string }>('admin', `/v2/admin/lojistas/${id}/delivery-dias`, { method: 'POST', corpo: { dias } });
export const repasseLoja = (id: string, acao: 'pagar' | 'recusar', motivo?: string) => api('admin', `/v2/admin/repasses-loja/${id}/${acao}`, { method: 'POST', corpo: { motivo } });
export const cancelarPedido = (id: string) => api('admin', `/v2/admin/pedidos/${id}/cancelar`, { method: 'POST' });
