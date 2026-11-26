// Serviços oferecidos e categorias de locais. Compartilhado entre o app e o servidor.
import type { CidadeId } from './cidades';
import { estimarIdaEVolta, precoFrete, precoSugerido, type Tarifa, type Urgencia } from '../services/preco';

// MOVI — "Sua cidade em movimento." Três linhas de serviço (Documento Conceitual):
//   MOVI GO    → transporte de passageiros (a pessoa vai)
//   MOVI LEVA  → compras e encomendas (só as coisas vão; o cliente não está junto)
//   MOVI COMBO → a pessoa e as compras juntas
export const MARCA = { nome: 'MOVI', slogan: 'Sua cidade em movimento.' };

export type ModalidadeId = 'go' | 'leva' | 'combo';
export const MODALIDADES: { id: ModalidadeId; nome: string; descricao: string }[] = [
  { id: 'combo', nome: 'MOVI COMBO', descricao: 'Você e suas compras' },
  { id: 'go', nome: 'MOVI GO', descricao: 'Levamos você' },
  { id: 'leva', nome: 'MOVI LEVA', descricao: 'Buscamos e entregamos' },
];

export type CategoriaId = 'mercado' | 'padaria' | 'farmacia' | 'gas_bebidas' | 'festa' | 'mecanico' | 'borracharia';

export const CATEGORIAS: { id: CategoriaId; nome: string; icone: string }[] = [
  { id: 'mercado', nome: 'Mercados', icone: '🛒' },
  { id: 'padaria', nome: 'Padarias', icone: '🥖' },
  { id: 'farmacia', nome: 'Farmácias', icone: '💊' },
  { id: 'gas_bebidas', nome: 'Gás e bebidas', icone: '🔥' },
  { id: 'festa', nome: 'Doces e festa', icone: '🎉' },
  { id: 'mecanico', nome: 'Mecânicos', icone: '🔧' },
  { id: 'borracharia', nome: 'Borracharias', icone: '🛞' },
];

export const LOJAS: CategoriaId[] = ['mercado', 'padaria', 'farmacia', 'gas_bebidas', 'festa'];

export type ServicoId = 'comigo' | 'ir' | 'buscar' | 'encomenda' | 'transporte' | 'borracharia' | 'loja_entrega' | 'loja_cliente';
/** Quem pede: o cliente (pessoa) ou o lojista (a loja pede para o cliente dela). */
export type Publico = 'cliente' | 'lojista';

/** Onde fica cada ponta da viagem: a casa do cliente, um local da lista (categorias) ou um endereço livre. */
export type Ponta = { casa?: boolean; categorias?: CategoriaId[]; livre?: boolean; gps?: boolean; rotulo: string };

export type Servico = {
  id: ServicoId;
  modalidade: ModalidadeId;
  publico: Publico;
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
    publico: 'cliente',
    modalidade: 'combo',
    titulo: 'Estou com as compras',
    sub: 'Já comprei e quero ir para casa com as compras',
    icone: '🛍️',
    clienteNaColeta: true,
    coleta: { categorias: LOJAS, livre: true, rotulo: 'Onde você está?' },
    entrega: { casa: true, livre: true, rotulo: 'Para onde?' },
  },
  {
    id: 'ir',
    publico: 'cliente',
    modalidade: 'go',
    titulo: 'Quero ir ao mercado',
    sub: 'Buscamos você em casa e levamos até a loja',
    icone: '🚗',
    clienteNaColeta: true,
    coleta: { casa: true, livre: true, gps: true, rotulo: 'Onde buscamos você?' },
    entrega: { categorias: LOJAS, livre: true, rotulo: 'Para onde?' },
    aviso: 'Para voltar com as compras, peça “Estou com as compras” (MOVI COMBO) quando terminar.',
  },
  {
    id: 'buscar',
    publico: 'cliente',
    modalidade: 'leva',
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
    publico: 'cliente',
    modalidade: 'leva',
    titulo: 'Buscar uma encomenda',
    sub: 'Doces de festa, pedidos prontos e outras retiradas: diga o que é e onde está',
    icone: '📮',
    clienteNaColeta: false,
    coleta: { livre: true, rotulo: 'Endereço completo da retirada' },
    entrega: { casa: true, rotulo: 'Entregar em' },
    descricao: { rotulo: 'O que é a encomenda', exemplo: 'Ex.: doces da festa encomendados na Dona Maria, 3 caixas' },
  },
  {
    id: 'transporte',
    publico: 'cliente',
    modalidade: 'go',
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
    publico: 'cliente',
    modalidade: 'go',
    titulo: 'Borracharia',
    sub: 'Buscamos você e o pneu, levamos à borracharia e trazemos de volta',
    icone: '🛞',
    clienteNaColeta: true,
    coleta: { casa: true, livre: true, gps: true, rotulo: 'Onde está o carro?' },
    entrega: { categorias: ['borracharia'], livre: true, rotulo: 'Qual borracharia?' },
    retorno: true,
    aviso: 'Leva e traz você e o pneu. O motorista não ajuda na troca do pneu.',
  },
  // ----- lojista: a loja pede o transporte das compras (e do cliente) dela -----
  {
    id: 'loja_entrega',
    publico: 'lojista',
    modalidade: 'leva',
    titulo: 'Entregar compras',
    sub: 'O motorista retira na loja e leva até a casa do seu cliente',
    icone: '📦',
    clienteNaColeta: true,
    coleta: { casa: true, rotulo: 'Retirar na loja' },
    entrega: { livre: true, rotulo: 'Endereço do cliente' },
    descricao: { rotulo: 'Cliente e pedido', exemplo: 'Ex.: Maria, (47) 99999-0000, pedido 123, 4 sacolas' },
  },
  {
    id: 'loja_cliente',
    publico: 'lojista',
    modalidade: 'combo',
    titulo: 'Levar cliente e compras',
    sub: 'Seu cliente vai para casa junto com as compras',
    icone: '🛍️',
    clienteNaColeta: true,
    coleta: { casa: true, rotulo: 'Embarque na loja' },
    entrega: { livre: true, rotulo: 'Endereço do cliente' },
    descricao: { rotulo: 'Nome e telefone do cliente', exemplo: 'Ex.: João, (47) 98888-0000' },
  },
];

export const servicoPorId = (id: unknown): Servico => SERVICOS.find((s) => s.id === id) ?? SERVICOS[0];

export type Veiculo = 'carro' | 'moto';
export const VEICULOS: { id: Veiculo; nome: string; icone: string }[] = [
  { id: 'carro', nome: 'Carro', icone: '🚗' },
  { id: 'moto', nome: 'Moto', icone: '🏍️' },
];

/**
 * Moto (motoboy): o Admin escolhe em quais serviços ela entra e a tabela própria da moto:
 * valor mínimo que cobre os primeiros km + valor por km excedente (km totais: moto até a coleta +
 * coleta até o destino). Padrão: R$ 9,00 até 2 km + R$ 1,80 por km acima de 2 km.
 */
export type ConfigMoto = { motoAtivo: boolean; motoServicos: ServicoId[]; motoMinimo: number; motoKmIncluso: number; motoPorKm: number; motoRepassePct: number };
export const MOTO_PADRAO: ConfigMoto = {
  motoAtivo: true,
  motoServicos: ['buscar', 'encomenda', 'loja_entrega'],
  motoMinimo: 9,
  motoKmIncluso: 2,
  motoPorKm: 1.8,
  motoRepassePct: 95,
};

/** Comissão do motorista (% do que o cliente paga) usada no preço da moto. */
type ComComissao = { comissaoMotoristaPct: number };
/**
 * O motoboy recebe motoRepassePct% da tabela (padrão 95%). Como ele fica com a comissão sobre o que o cliente
 * paga (padrão 80%), o cliente paga tabela × 95 ÷ 80 (= tabela + 18,75%). Sem urgência aqui.
 */
export const fatorMoto = (cfg: ConfigMoto & ComComissao) => cfg.motoRepassePct / Math.max(1, cfg.comissaoMotoristaPct);
export const precoMoto = (km: number, cfg: ConfigMoto & ComComissao) => Math.round(tarifaMoto(km, cfg) * fatorMoto(cfg) * 100) / 100;
/** Tabela divulgada da moto para uma distância total (sem o acréscimo da plataforma e sem urgência). */
export const tarifaMoto = (km: number, cfg: ConfigMoto) => Math.round((cfg.motoMinimo + Math.max(0, km - cfg.motoKmIncluso) * cfg.motoPorKm) * 100) / 100;
export const aceitaMoto = (servico: ServicoId, cfg: ConfigMoto) => cfg.motoAtivo && cfg.motoServicos.includes(servico);

export type ConfigPreco = ConfigMoto & ComComissao & { tarifas: Tarifa[]; margem: number; urgencia: Urgencia; esperaBorrachariaMin?: number };

/** Percurso cobrado: do motorista até a coleta (deslocamento) e da coleta até o destino (viagem). */
export type Percurso = { kmDesloc: number; minDesloc: number; kmViagem: number; minViagem: number };

/**
 * Preço de qualquer serviço: deslocamento do motorista até a coleta + viagem da coleta ao destino
 * (na borracharia, ida e volta e a espera), com as tarifas Uber/99, a margem e a urgência do Admin.
 * Moto: tabela própria (mínimo + km excedente) sobre os km totais; a urgência do pedido "agora" vale igual.
 */
export function precoServico(p: Percurso, cfg: ConfigPreco, servico: ServicoId, agendado: boolean, veiculo: Veiculo = 'carro') {
  if (veiculo === 'moto') return precoFrete(precoMoto(p.kmDesloc + p.kmViagem, cfg), agendado, cfg.urgencia);
  const espera = servico === 'borracharia' ? (cfg.esperaBorrachariaMin ?? 20) : 0;
  const t = { kmIda: p.kmDesloc, minIda: p.minDesloc + espera, kmVolta: p.kmViagem, minVolta: p.minViagem };
  const sugerido = precoSugerido(
    cfg.tarifas.map((x) => estimarIdaEVolta(t, x)),
    cfg.margem,
  );
  return precoFrete(sugerido, agendado, cfg.urgencia);
}

/** O que está liberado para os clientes (Admin → Serviços). No lançamento: só mercados. */
export type Liberacao = { servicosAtivos: ServicoId[]; categoriasAtivas: CategoriaId[]; outroEnderecoLoja: boolean; cidadesAtivas: CidadeId[] };
export const LIBERACAO_PADRAO: Liberacao = {
  servicosAtivos: ['comigo', 'ir', 'buscar', 'loja_entrega', 'loja_cliente'],
  categoriasAtivas: ['mercado'],
  outroEnderecoLoja: false,
  // Região liberada para teste; o Admin desliga as cidades que ainda não atende.
  cidadesAtivas: ['guaramirim', 'jaragua', 'schroeder', 'massaranduba', 'joinville'],
};

const ehLoja = (p: Ponta) => !!p.categorias?.some((c) => LOJAS.includes(c));
/** Categorias que o cliente vê nesta ponta (só as liberadas no Admin). */
export const categoriasVisiveis = (p: Ponta, lib: Liberacao) => (p.categorias ?? []).filter((c) => lib.categoriasAtivas.includes(c));
/** "Outro endereço": livre na casa/trabalho/oficina; numa loja, só se o Admin permitir. */
export const livrePermitido = (p: Ponta, lib: Liberacao) => !!p.livre && (!ehLoja(p) || lib.outroEnderecoLoja);
export const servicosLiberados = (lib: Liberacao, publico: Publico = 'cliente') => SERVICOS.filter((s) => s.publico === publico && lib.servicosAtivos.includes(s.id));
