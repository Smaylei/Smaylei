import type { CidadeId } from './cidades';
import type { CategoriaId } from './servicos';
import { MERCADOS } from './mercados';

export type Local = { id: string; categoria: CategoriaId; nome: string; endereco: string; lat: number; lon: number; cidade?: CidadeId | null };

const CIDADE = 'Guaramirim - SC';

// Lista inicial (OpenStreetMap). O Admin edita, desativa e cadastra novos locais pelo app.
export const LOCAIS_INICIAIS: Local[] = [
  ...MERCADOS.map((m) => ({ ...m, categoria: 'mercado' as const })),
  { id: 'padaria-avai', categoria: 'padaria', nome: 'Padaria do Avaí', endereco: `Rua 28 de Agosto, 3837, Avaí, ${CIDADE}`, lat: -26.4679344, lon: -48.9789199 },
  { id: 'padaria-junior', categoria: 'padaria', nome: 'Padaria e Mercearia Júnior', endereco: `Estrada Bananal, 1321, Beira Rio, ${CIDADE}`, lat: -26.4797521, lon: -48.9868189 },
  { id: 'padaria-nona', categoria: 'padaria', nome: 'Panificadora e Confeitaria da Nona', endereco: `Rodovia Guilherme Jensen, Rio Branco, ${CIDADE}`, lat: -26.5224881, lon: -48.9824941 },
  { id: 'farm-sesi', categoria: 'farmacia', nome: 'Farmácia Sesi', endereco: `Rua 28 de Agosto, Nova Esperança, ${CIDADE}`, lat: -26.4741453, lon: -49.0152192 },
  { id: 'farm-masterfarma', categoria: 'farmacia', nome: 'Masterfarma', endereco: `Rua 28 de Agosto, 640, Centro, ${CIDADE}`, lat: -26.474475, lon: -49.0084869 },
  { id: 'farm-prawucki', categoria: 'farmacia', nome: 'Farmácia Prawucki', endereco: `Rua 28 de Agosto, Centro, ${CIDADE}`, lat: -26.4744238, lon: -49.0043455 },
  { id: 'farm-calcadao', categoria: 'farmacia', nome: 'Farmácia Calçadão', endereco: `Rua 28 de Agosto, Centro, ${CIDADE}`, lat: -26.4743901, lon: -49.0018619 },
  { id: 'farm-preco-popular', categoria: 'farmacia', nome: 'Farmácia Preço Popular', endereco: `Rua 28 de Agosto, 1700, Centro, ${CIDADE}`, lat: -26.4738708, lon: -48.9980344 },
  { id: 'farm-biofar', categoria: 'farmacia', nome: 'Biofar', endereco: `Rua 28 de Agosto, Centro, ${CIDADE}`, lat: -26.4723282, lon: -48.9944698 },
  { id: 'farm-catia', categoria: 'farmacia', nome: 'Farmácia Cátia', endereco: `Rodovia Guilherme Jensen, Rio Branco, ${CIDADE}`, lat: -26.5215536, lon: -48.9817967 },
  { id: 'mec-serpa', categoria: 'mecanico', nome: 'Mecânica Serpa', endereco: `Rua Alfredo Pieper, Nova Esperança, ${CIDADE}`, lat: -26.4759409, lon: -49.0144851 },
  { id: 'borr-rozacco', categoria: 'borracharia', nome: 'Rozacco Pneus', endereco: `Rua Norberto Silveira Júnior, Centro, ${CIDADE}`, lat: -26.4765988, lon: -49.001131 },
  { id: 'borr-speed', categoria: 'borracharia', nome: 'Speed Pneus', endereco: `Rua Henrique Friedmann, 264, Centro, ${CIDADE}`, lat: -26.4767285, lon: -49.0061211 },
];

// Mercados das cidades vizinhas (OpenStreetMap), liberados para teste. Schroeder: cadastrar pelo Admin.
export const LOCAIS_REGIAO: Local[] = [
  { id: 'jar-cooper-supermercado', categoria: 'mercado', nome: "Cooper Supermercado", endereco: "Rua João Wiest Júnior 1399, Água Verde, Jaraguá do Sul - SC", lat: -26.473193, lon: -49.111790 },
  { id: 'jar-supermercado-angeloni', categoria: 'mercado', nome: "Supermercado Angeloni", endereco: "Rua Coronel Bernardo Grubba 250, Centro, Jaraguá do Sul - SC", lat: -26.477561, lon: -49.091609 },
  { id: 'jar-supermercado-cooper-centro', categoria: 'mercado', nome: "Supermercado Cooper Centro", endereco: "Rua Reinoldo Rau 660, Centro, Jaraguá do Sul - SC", lat: -26.489513, lon: -49.081505 },
  { id: 'jar-supermercado-cooper-vila-nova', categoria: 'mercado', nome: "Supermercado Cooper Vila Nova", endereco: "Rua Walter Marquardt 225, Vila Nova, Jaraguá do Sul - SC", lat: -26.497536, lon: -49.086755 },
  { id: 'jar-supermercado-cooper-barra', categoria: 'mercado', nome: "Supermercado Cooper Barra", endereco: "Rua Padre Aluísio Boeing 86, Barra do Rio Cerro, Jaraguá do Sul - SC", lat: -26.513536, lon: -49.120834 },
  { id: 'jar-supermercado-gumz', categoria: 'mercado', nome: "Supermercado Gumz", endereco: "Rua Gustavo Gumz 548, Rio Cerro II, Jaraguá do Sul - SC", lat: -26.579781, lon: -49.140403 },
  { id: 'jar-supermercado-pirao', categoria: 'mercado', nome: "Supermercado Pirão", endereco: "Rua José Narloch 2130, Tifa Martins, Jaraguá do Sul - SC", lat: -26.489664, lon: -49.117048 },
  { id: 'jar-supermercado-cantelli', categoria: 'mercado', nome: "Supermercado Cantelli", endereco: "Rua Prefeito José Bauer 1011, Rau, Jaraguá do Sul - SC", lat: -26.458790, lon: -49.113344 },
  { id: 'jar-supermercado-figueira', categoria: 'mercado', nome: "Supermercado Figueira", endereco: "Rua José Theodoro Ribeiro 920, Ilha da Figueira, Jaraguá do Sul - SC", lat: -26.491476, lon: -49.062367 },
  { id: 'jar-supermercado-karolina', categoria: 'mercado', nome: "Supermercado Karolina", endereco: "Rua Roberto Ziemann, Amizade, Jaraguá do Sul - SC", lat: -26.457729, lon: -49.105215 },
  { id: 'jar-supermercado-esquina', categoria: 'mercado', nome: "Supermercado Esquina", endereco: "Rua Roberto Ziemann 295, Czerniewicz, Jaraguá do Sul - SC", lat: -26.471383, lon: -49.090605 },
  { id: 'jar-supermercado-santa-luzia', categoria: 'mercado', nome: "Supermercado Santa Luzia", endereco: "Rua Carlos Frederico Ramthum 17377, Santa Luzia, Jaraguá do Sul - SC", lat: -26.366873, lon: -49.127056 },
  { id: 'jar-supermercado-frontal', categoria: 'mercado', nome: "Supermercado Frontal", endereco: "Avenida Prefeito Waldemar Grubba 3051, Vila Lalau, Jaraguá do Sul - SC", lat: -26.477942, lon: -49.052599 },
  { id: 'jar-supermercado-rancho-bom', categoria: 'mercado', nome: "Supermercado Rancho Bom", endereco: "Rua João Januário Ayroso 1616, Jaraguá Esquerdo, Jaraguá do Sul - SC", lat: -26.503498, lon: -49.094487 },
  { id: 'jar-giassi-supermercados', categoria: 'mercado', nome: "Giassi Supermercados", endereco: "Rua Expedicionário Gumercindo da Silva 311, Centro, Jaraguá do Sul - SC", lat: -26.481178, lon: -49.086314 },
  { id: 'jar-komprao-koch-atacadista', categoria: 'mercado', nome: "Komprão Koch Atacadista", endereco: "Rua 1590 331, Vila Lenzi, Jaraguá do Sul - SC", lat: -26.479593, lon: -49.100945 },
  { id: 'jar-fort-atacadista', categoria: 'mercado', nome: "Fort Atacadista", endereco: "Rua Max Wilhelm 594, Vila Baependi, Jaraguá do Sul - SC", lat: -26.482129, lon: -49.074678 },
  { id: 'mas-supermercado-pimentel', categoria: 'mercado', nome: "Supermercado Pimentel", endereco: "Rua 11 de Novembro, Centro, Massaranduba - SC", lat: -26.602509, lon: -48.994832 },
  { id: 'joi-supermercado-condor', categoria: 'mercado', nome: "Supermercado Condor", endereco: "Rua Florianópolis 100, Bucarein, Joinville - SC", lat: -26.322777, lon: -48.840570 },
  { id: 'joi-supermercado-rodrigues', categoria: 'mercado', nome: "Supermercado Rodrigues", endereco: "Rua Tuiuti 2295, Aventureiro, Joinville - SC", lat: -26.251781, lon: -48.820281 },
  { id: 'joi-supermercado-albino', categoria: 'mercado', nome: "Supermercado Albino", endereco: "Rua Tenente Antônio João 2605, Bom Retiro, Joinville - SC", lat: -26.254754, lon: -48.849595 },
  { id: 'joi-supermercado-impeatriz', categoria: 'mercado', nome: "Supermercado Impeatriz", endereco: "Rua Doutor João Colin 1777, América, Joinville - SC", lat: -26.284805, lon: -48.849571 },
  { id: 'joi-bistek-supermercado', categoria: 'mercado', nome: "Bistek Supermercado", endereco: "Rua Tuiuti 1500, Aventureiro, Joinville - SC", lat: -26.258031, lon: -48.819646 },
  { id: 'joi-supermercado-vitorino', categoria: 'mercado', nome: "Supermercado Vitorino", endereco: "Rua Santa Catarina 1964, Floresta, Joinville - SC", lat: -26.340812, lon: -48.847937 },
  { id: 'joi-supermercado-do-povo-atacarejo', categoria: 'mercado', nome: "Supermercado do Povo Atacarejo", endereco: "Rua Monsenhor Gercino 4186, João Costa, Joinville - SC", lat: -26.340200, lon: -48.812466 },
  { id: 'joi-supermercado-benvenutti', categoria: 'mercado', nome: "Supermercado Benvenutti", endereco: "Rua Ernesto Bachtold 3104, Aventureiro, Joinville - SC", lat: -26.248176, lon: -48.797892 },
  { id: 'joi-supermercado-bobato', categoria: 'mercado', nome: "Supermercado Bobato", endereco: "Rua Quinze de Outubro 2033, Rio Bonito, Joinville - SC", lat: -26.159863, lon: -48.904495 },
  { id: 'joi-supermercado-catarinao', categoria: 'mercado', nome: "Supermercado Catarinão", endereco: "Rua Santa Catarina 969, Floresta, Joinville - SC", lat: -26.331285, lon: -48.846497 },
  { id: 'joi-supermercado-mattei', categoria: 'mercado', nome: "Supermercado Mattei", endereco: "Rua Albano Schmidt 2296, Boa Vista, Joinville - SC", lat: -26.296101, lon: -48.817732 },
  { id: 'joi-supermercado-promocional', categoria: 'mercado', nome: "Supermercado Promocional", endereco: "Rua Iririú 352, Saguaçu, Joinville - SC", lat: -26.281492, lon: -48.838075 },
  { id: 'joi-supermercado-koch', categoria: 'mercado', nome: "Supermercado Koch", endereco: "Rua Antônio Jorge Cecyn 202, Aventureiro, Joinville - SC", lat: -26.239569, lon: -48.817042 },
  { id: 'joi-fort-atacadista', categoria: 'mercado', nome: "Fort Atacadista", endereco: "4157, Aventureiro, Joinville - SC", lat: -26.237353, lon: -48.819000 },
  { id: 'joi-brasil-atacadista', categoria: 'mercado', nome: "Brasil Atacadista", endereco: "Rua Albano Schmidt 1200, Boa Vista, Joinville - SC", lat: -26.304271, lon: -48.823597 },
  { id: 'joi-komprao-koch-atacadista', categoria: 'mercado', nome: "Komprão Koch Atacadista", endereco: "Rua Albano Schmidt 700, Boa Vista, Joinville - SC", lat: -26.308378, lon: -48.826478 },
];
