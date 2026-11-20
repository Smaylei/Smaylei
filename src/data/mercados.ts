export type Mercado = {
  id: string;
  nome: string;
  endereco: string;
  /** Posição da loja (OpenStreetMap; Super Três estimado pela numeração métrica da rua). */
  lat: number;
  lon: number;
};

const CIDADE = 'Guaramirim - SC, 89270-000, Brasil';

// Endereços: site oficial da Cooper, cadastros de CNPJ e guias comerciais.
// Posições: OpenStreetMap. O Super Três não está no mapa; sua posição foi estimada
// pela numeração métrica da Rua 28 de Agosto (nº 4014, 979 m a leste do Martini, nº 3035).
export const MERCADOS: Mercado[] = [
  { id: 'cooper', nome: 'Cooper Atacarejo', endereco: `Rua Aldano José Vieira, 455, Avaí, ${CIDADE}`, lat: -26.471870, lon: -48.976217 },
  { id: 'komprao', nome: 'Komprão Koch Atacadista', endereco: `Rua Vereador João Pereira Lima, 697, Centro, ${CIDADE}`, lat: -26.477937, lon: -49.008388 },
  { id: 'burei', nome: 'Burei Supermercado', endereco: `Rua 28 de Agosto, 502, Centro, ${CIDADE}`, lat: -26.474667, lon: -49.009491 },
  { id: 'super-tres', nome: 'Super Três', endereco: `Rua 28 de Agosto, 4014, Centro, ${CIDADE}`, lat: -26.468054, lon: -48.977024 },
  { id: 'martini', nome: 'Supermercado Martini', endereco: `Rua 28 de Agosto, 3035, ${CIDADE}`, lat: -26.470387, lon: -48.986302 },
];
