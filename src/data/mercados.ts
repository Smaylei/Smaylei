export type Mercado = {
  id: string;
  nome: string;
  endereco: string;
  /** Coordenadas aproximadas, usadas só se a geocodificação do endereço falhar. */
  latAprox: number;
  lonAprox: number;
};

const CIDADE = 'Guaramirim - SC, 89270-000, Brasil';

// Endereços levantados em guias comerciais públicos (Solutudo, Guia Telefone,
// Lista Amarela, guaramirim.com.br). Confira no Google Maps antes de publicar.
export const MERCADOS: Mercado[] = [
  { id: 'breithaupt', nome: 'Hipermercado Breithaupt', endereco: `Rua 28 de Agosto, 1665, Avaí, ${CIDADE}`, latAprox: -26.4745, lonAprox: -49.0105 },
  { id: 'rancho-bom', nome: 'Rancho Bom Supermercados', endereco: `Rua Geronimo Correa, 444, Centro, ${CIDADE}`, latAprox: -26.4712, lonAprox: -49.0010 },
  { id: 'martini', nome: 'Supermercado Martini', endereco: `Rua 28 de Agosto, 3035, ${CIDADE}`, latAprox: -26.4728, lonAprox: -49.0000 },
  { id: 'super-tres', nome: 'Super Três', endereco: `Rua 28 de Agosto, 4014, Centro, ${CIDADE}`, latAprox: -26.4720, lonAprox: -48.9960 },
  { id: 'pimentel', nome: 'Supermercado Pimentel', endereco: `Rua 28 de Agosto, 862, Avaí, ${CIDADE}`, latAprox: -26.4760, lonAprox: -49.0150 },
  { id: 'burei', nome: 'Burei Supermercado', endereco: `Rua 28 de Agosto, 502, Centro, ${CIDADE}`, latAprox: -26.4768, lonAprox: -49.0175 },
  { id: 'silva', nome: 'Supermercado Silva', endereco: `Rua Norberto Silveira Júnior, 233, Centro, ${CIDADE}`, latAprox: -26.4735, lonAprox: -49.0030 },
  { id: 'cantelli', nome: 'Supermercado Cantelli', endereco: `Rodovia SC-413, 753, Centro, ${CIDADE}`, latAprox: -26.4690, lonAprox: -49.0045 },
  { id: 'klein', nome: 'Supermercado Klein', endereco: `Rua Lauro Zimmermann, 6380, Guamiranga, ${CIDADE}`, latAprox: -26.4420, lonAprox: -49.0230 },
  { id: 'super-preco', nome: 'Super Preço', endereco: `Rua Hermínio Stringari, 1500, Corticeira, ${CIDADE}`, latAprox: -26.4870, lonAprox: -48.9850 },
];
