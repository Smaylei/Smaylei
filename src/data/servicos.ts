// Serviços oferecidos e categorias de locais. Compartilhado entre o app e o servidor.
import { estimarIdaEVolta, precoFrete, precoSugerido, type Tarifa, type Trajeto, type Urgencia } from '../services/preco';

export type CategoriaId = 'mercado' | 'padaria' | 'farmacia' | 'gas_bebidas' | 'mecanico' | 'borracharia';

export const CATEGORIAS: { id: CategoriaId; nome: string; icone: string }[] = [
  { id: 'mercado', nome: 'Mercados', icone: '🛒' },
  { id: 'padaria', nome: 'Padarias', icone: '🥖' },
  { id: 'farmacia', nome: 'Farmácias', icone: '💊' },
  { id: 'gas_bebidas', nome: 'Gás e bebidas', icone: '🔥' },
  { id: 'mecanico', nome: 'Mecânicos', icone: '🔧' },
  { id: 'borracharia', nome: 'Borracharias', icone: '🛞' },
];

export const LOJAS: CategoriaId[] = ['mercado', 'padaria', 'farmacia', 'gas_bebidas'];

export type ServicoId = 'comigo' | 'ir' | 'buscar' | 'encomenda' | 'transporte' | 'borracharia';

/** Onde fica cada ponta da viagem: a casa do cliente, um local da lista (categorias) ou um endereço livre. */
export type Ponta = { casa?: boolean; categorias?: CategoriaId[]; livre?: boolean; gps?: boolean; rotulo: string };

export type Servico = {
  id: ServicoId;
  titulo: string;
  sub: string;
  icone: string;
  /** O cliente está na coleta? Então ele confirma a chegada do motorista lá (libera o pagamento). */
  clienteNaColeta: boolean;
  coleta: Ponta;
  entrega: Ponta;
  /** Campo de texto obrigatório (o que buscar). */
  descricao?: { rotulo: string; exemplo: string };
  /** Leva e traz: o motorista espera e volta à coleta. */
  retorno?: boolean;
  /** Pode agendar vários dias de uma vez (com ida e volta). */
  variosDias?: boolean;
  aviso?: string;
};

export const SERVICOS: Servico[] = [
  {
    id: 'comigo',
    titulo: 'Estou com as compras',
    sub: 'Estou no mercado, padaria ou farmácia e quero ir para casa',
    icone: '🛍️',
    clienteNaColeta: true,
    coleta: { categorias: LOJAS, livre: true, rotulo: 'Onde você está?' },
    entrega: { casa: true, livre: true, rotulo: 'Para onde?' },
  },
  {
    id: 'ir',
    titulo: 'Quero ir até lá',
    sub: 'Busco você em casa e levo ao mercado, padaria ou farmácia',
    icone: '🚗',
    clienteNaColeta: true,
    coleta: { casa: true, livre: true, gps: true, rotulo: 'Onde buscamos você?' },
    entrega: { categorias: LOJAS, livre: true, rotulo: 'Para onde?' },
    aviso: 'Para voltar com as compras, peça “Estou com as compras” quando terminar.',
  },
  {
    id: 'buscar',
    titulo: 'Só buscar minhas compras',
    sub: 'O motorista retira e entrega na sua casa',
    icone: '📦',
    clienteNaColeta: false,
    coleta: { categorias: LOJAS, livre: true, rotulo: 'Onde estão as compras?' },
    entrega: { casa: true, rotulo: 'Entregar em' },
    descricao: { rotulo: 'O que retirar', exemplo: 'Ex.: pedido nº 123 em nome de Ana, 2 sacolas já pagas' },
    aviso: 'As compras precisam estar pagas e separadas na loja. O motorista só retira e entrega.',
  },
  {
    id: 'encomenda',
    titulo: 'Buscar uma encomenda',
    sub: 'Diga o que é e o endereço completo; trazemos até você',
    icone: '📮',
    clienteNaColeta: false,
    coleta: { livre: true, rotulo: 'Endereço completo da retirada' },
    entrega: { casa: true, rotulo: 'Entregar em' },
    descricao: { rotulo: 'O que é a encomenda', exemplo: 'Ex.: caixa média com documentos, falar com João' },
  },
  {
    id: 'transporte',
    titulo: 'Carro na oficina',
    sub: 'Transporte para o trabalho todos os dias e para buscar o carro',
    icone: '🔧',
    clienteNaColeta: true,
    coleta: { casa: true, categorias: ['mecanico'], livre: true, gps: true, rotulo: 'Buscar você em' },
    entrega: { casa: true, categorias: ['mecanico'], livre: true, rotulo: 'Levar até' },
    variosDias: true,
  },
  {
    id: 'borracharia',
    titulo: 'Borracharia',
    sub: 'Buscamos você e o pneu, levamos à borracharia e trazemos de volta',
    icone: '🛞',
    clienteNaColeta: true,
    coleta: { casa: true, livre: true, gps: true, rotulo: 'Onde está o carro?' },
    entrega: { categorias: ['borracharia'], livre: true, rotulo: 'Qual borracharia?' },
    retorno: true,
    aviso: 'Leva e traz você e o pneu. O motorista não ajuda na troca do pneu.',
  },
];

export const servicoPorId = (id: unknown): Servico => SERVICOS.find((s) => s.id === id) ?? SERVICOS[0];

export type ConfigPreco = { tarifas: Tarifa[]; margem: number; urgencia: Urgencia; esperaBorrachariaMin?: number };

/**
 * Preço de qualquer serviço: o percurso coleta → entrega → coleta (o motorista volta ao ponto de
 * partida), com as tarifas Uber/99 e a margem do Admin. Na borracharia soma a espera do motorista.
 */
export function precoServico(r: Trajeto, cfg: ConfigPreco, servico: ServicoId, agendado: boolean) {
  const espera = servico === 'borracharia' ? (cfg.esperaBorrachariaMin ?? 20) : 0;
  const t = { ...r, minIda: r.minIda + espera };
  const sugerido = precoSugerido(cfg.tarifas.map((x) => estimarIdaEVolta(t, x)), cfg.margem);
  return precoFrete(sugerido, agendado, cfg.urgencia);
}
