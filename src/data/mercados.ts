export type Mercado = {
  id: string;
  nome: string;
  endereco: string;
  /** Coordenadas aproximadas, usadas só se a geocodificação do endereço falhar. */
  latAprox: number;
  lonAprox: number;
};

const CIDADE = 'Guaramirim - SC, 89270-000, Brasil';

// Endereços levantados no site oficial da Cooper, em cadastros de CNPJ e em
// guias comerciais públicos. Confira no Google Maps antes de publicar.
export const MERCADOS: Mercado[] = [
  { id: 'cooper', nome: 'Cooper Atacarejo', endereco: `Rua Aldano José Vieira, 455, Avaí, ${CIDADE}`, latAprox: -26.4790, lonAprox: -49.0120 },
  { id: 'komprao', nome: 'Komprão Koch Atacadista', endereco: `Rua Vereador João Pereira Lima, 697, Centro, ${CIDADE}`, latAprox: -26.4715, lonAprox: -49.0020 },
  { id: 'burei', nome: 'Burei Supermercado', endereco: `Rua 28 de Agosto, 502, Centro, ${CIDADE}`, latAprox: -26.4768, lonAprox: -49.0175 },
  { id: 'super-tres', nome: 'Super Três', endereco: `Rua 28 de Agosto, 4014, Centro, ${CIDADE}`, latAprox: -26.4720, lonAprox: -48.9960 },
  { id: 'martini', nome: 'Supermercado Martini', endereco: `Rua 28 de Agosto, 3035, ${CIDADE}`, latAprox: -26.4728, lonAprox: -49.0000 },
];
