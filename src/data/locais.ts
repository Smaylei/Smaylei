import type { CategoriaId } from './servicos';
import { MERCADOS } from './mercados';

export type Local = { id: string; categoria: CategoriaId; nome: string; endereco: string; lat: number; lon: number };

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
