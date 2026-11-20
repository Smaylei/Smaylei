# 🛒 Mercado Frete

App Android e iOS (Expo / React Native) que calcula o valor do frete de compras de
supermercado em **Guaramirim/SC**, com base no **km rodado** e nas tarifas de **Uber** e **99**.

O percurso cobrado é sempre **ida e volta**: mercado → endereço do cliente → mercado.

## Como funciona

1. O usuário escolhe o mercado de partida (10 supermercados de Guaramirim já cadastrados).
2. Digita o endereço de entrega ou usa a localização do celular.
3. O app calcula a rota real de carro (ida e volta) e mostra:
   - km da ida, km da volta, km total e tempo total;
   - preço estimado **UberX** e **99Pop** para o percurso completo;
   - **valor sugerido** do frete (média Uber/99 + margem opcional) e o R$/km resultante.

### Fórmula

```
km_total  = km_ida + km_volta
min_total = min_ida + min_volta
preço     = máx(tarifa_mínima, tarifa_base + km_total × R$/km + min_total × R$/min)
sugerido  = média(UberX, 99Pop) × (1 + margem%)
```

### Tarifas padrão (editáveis na aba "Tarifas Uber/99")

| Categoria | Base | R$/km | R$/min | Mínima |
|-----------|------|-------|--------|--------|
| UberX     | 2,00 | 1,35  | 0,26   | 7,00   |
| 99Pop     | 2,30 | 1,30  | 0,22   | 6,50   |

> **Importante:** Uber e 99 **não oferecem API pública de preços** nem publicam tabela oficial
> por cidade; o preço real é dinâmico (demanda/horário). Os valores acima partem de referências
> públicas para Joinville/região e médias de 2026. **Calibre**: simule a mesma corrida nos apps
> oficiais e ajuste os campos até bater. Os valores ficam salvos no celular.

## Fontes de dados

- **Rotas (km e tempo):** OSRM (OpenStreetMap). O servidor público é só para testes; em
  produção use um servidor OSRM próprio ou a Google Directions API.
- **Endereços → coordenadas:** geocodificador nativo do celular, com Nominatim (OpenStreetMap)
  como alternativa. As coordenadas de cada mercado ficam em cache no aparelho.
- **Sem internet:** distância estimada em linha reta × 1,35 a 35 km/h (o app avisa).
- **Mercados:** `src/data/mercados.ts`. Os endereços vêm de guias comerciais públicos; confira no
  Google Maps antes de publicar e edite a lista à vontade.

## Rodando

```bash
npm install
npx expo start        # abra no celular com o app Expo Go (Android/iOS)
npm test              # testes do cálculo de preço
npm run typecheck
```

Para publicar nas lojas: `npx eas-cli@latest build --platform android|ios` e depois
`npx eas-cli@latest submit`. Os identificadores (`br.com.mercadofrete.app`) estão em `app.json`.

## Estrutura

```
App.tsx                         abas Calcular / Tarifas
src/components/TelaCalculo.tsx  escolha do mercado, endereço e resultado
src/components/TelaTarifas.tsx  edição das tarifas Uber/99 e margem
src/services/preco.ts           cálculo do preço (puro, testado)
src/services/rota.ts            geocodificação + rota ida/volta (OSRM)
src/data/mercados.ts            supermercados de Guaramirim
src/data/tarifas.ts             tarifas padrão Uber/99
tests/preco.test.ts             testes
```
