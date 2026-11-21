# MOVI — Sua cidade em movimento.

Plataforma local sob demanda para movimentar pessoas e transportar o que elas precisam (antigo "Mercado Frete").
Três apps no mesmo projeto: **MOVI** (cliente), **MOVI Motorista** (parceiro) e **MOVI Admin**.

### Linhas de serviço

| Linha | Serviços |
|---|---|
| **MOVI COMBO** · você e suas compras | Estou com as compras |
| **MOVI GO** · levamos você | Quero ir ao mercado · Carro na oficina (vários dias, ida e volta) · Borracharia (leva e traz) |
| **MOVI LEVA** · buscamos e entregamos | Só buscar minhas compras · Buscar uma encomenda (doces de festa, pedidos prontos…) |

**Lançamento: só mercados.** Os demais serviços e as categorias (padarias, farmácias, gás e bebidas, doces
e festa, mecânicos, borracharias) já estão prontos e ficam desligados até o Admin liberar em
*Serviços liberados*. O servidor recusa pedidos de serviços/categorias desligados.

---

App Android e iOS (Expo / React Native) que calcula o valor do frete de compras de
supermercado em **Guaramirim/SC**, com base no **km rodado** e nas tarifas de **Uber** e **99**.

O percurso cobrado é sempre **ida e volta**: mercado → endereço do cliente → mercado.

## Como funciona

1. O usuário cadastra o endereço uma vez (digitando ou pelo GPS).
2. O app já mostra o frete de cada mercado (Cooper, Komprão, Burei, Super Três e Martini); tocar num mercado abre o detalhe.
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
- **Mercados:** `src/data/mercados.ts` (app) e `web/mercado-frete.html` (versão PC). Os endereços vêm do site da Cooper, de cadastros de CNPJ e de guias comerciais; confira no
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

## Versão para PC (navegador)

`web/mercado-frete.html` + `web/guaramirim-ruas.json`: o mesmo cálculo, sem internet para
rotas. O mapa de ruas de Guaramirim (OpenStreetMap, ODbL) vai embutido no JSON e a rota ida e
volta é calculada no próprio navegador (Dijkstra pelo menor tempo, respeitando mão única).
A pessoa cadastra o endereço marcando a casa no mapa; depois cada mercado já mostra o frete.

## Agendamento e pagamento (app)

- **Agendar:** o cliente escolhe o dia e a faixa de horário (mínimo 1 h de antecedência) e paga o
  frete calculado.
- **Agora (urgente):** sem agendamento, o frete recebe o acréscimo de urgência (padrão +10%,
  configurável em % ou R$ na aba "Tarifas").
- **Pagamento:** só o frete, por Pix ou cartão, pelo Checkout Integrado da InfinitePay
  (`src/services/pagamento.ts`, InfiniteTag em `src/config.ts`). O app gera o link
  (`POST https://api.checkout.infinitepay.io/links`), abre o checkout e, ao voltar, confirma em
  `/payment_check`. Nenhuma chave secreta fica no app.
- **Checkout integrado:** ativado na conta (testado: a API devolve `{ "url": "https://checkout.infinitepay.io/smayleiluiz?lenc=..." }`).
- **Confirmação automática no servidor (webhook):** ainda não implementada; hoje a confirmação
  acontece quando o cliente volta do checkout para o app.
- **Retorno ao app:** a InfinitePay só aceita `redirect_url` https (recusa `mercadofrete://`).
  Enquanto não houver uma página https de retorno (`URL_RETORNO_PAGAMENTO` em `src/config.ts`),
  o checkout abre sem retorno e o cliente vê o comprovante na própria InfinitePay.
- **API Key (`inchk_...`):** só no servidor, nunca no app nem no repositório. Ela habilita
  `options` como `single_payment` e `valid_until`.

## Gerar o app (Android e iOS)

O build roda na nuvem da Expo (EAS), sem Android Studio nem Xcode. Perfis em `eas.json`:

| Perfil | Android | iOS |
|---|---|---|
| `preview` | APK para instalar direto no celular | instalação interna (iPhones cadastrados) |
| `production` | AAB para a Google Play | build para App Store / TestFlight |

```bash
npm install
npx eas-cli@latest login                 # conta grátis em expo.dev
npx eas-cli@latest init                  # vincula o projeto à sua conta (1ª vez)

# Android: APK para testar/distribuir direto
npx eas-cli@latest build -p android --profile preview

# iOS: exige Apple Developer Program (US$ 99/ano)
npx eas-cli@latest build -p ios --profile production
npx eas-cli@latest submit -p ios          # envia ao TestFlight / App Store

# Google Play (conta de desenvolvedor: US$ 25, pagamento único)
npx eas-cli@latest build -p android --profile production
npx eas-cli@latest submit -p android
```

Ícone, splash, nome ("Mercado Frete") e identificadores (`br.com.mercadofrete.app`) estão em
`app.json`. A numeração de versão é controlada pela EAS (`appVersionSource: remote`).

## App Admin ("Frete Admin")

Mesmo projeto, outra variante (`APP_VARIANT=admin`): nome, ícone e identificador próprios
(`br.com.mercadofrete.admin`).

- **Painel:** fretes próximos, aguardando pagamento e histórico; cliente, WhatsApp, endereço
  (botão Navegar), mercado e valor; Concluir/Cancelar. Interruptor **Aceitando pedidos** e botão
  **Estou livre** (encerra o atendimento em andamento e libera os horários).
- **Agenda:** cada frete pago vira evento na agenda do celular (Google Agenda no Android,
  Calendário no iPhone) com lembrete 15 min antes; cancelado sai da agenda.
- **Ajustes:** horário de atendimento, bloqueio por frete (40 min), intervalo entre horários,
- Acesso com a senha `ADMIN_TOKEN` cadastrada na Cloudflare.

```bash
# testar no celular (Expo Go)
$env:APP_VARIANT="admin"; npx expo start        # PowerShell
APP_VARIANT=admin npx expo start                # macOS/Linux

# gerar
npx eas-cli@latest build -p android --profile admin-preview
npx eas-cli@latest build -p ios --profile admin-production
```

## Fim do atendimento: avaliação, gorjeta e sugestões

- Quando o frete é entregue, o cliente vê um cartão para dar **nota de 1 a 5**, uma **gorjeta opcional**
  (R$ 2, 5, 10 ou outro valor, até R$ 200) e uma **caixa de sugestões**.
- A **gorjeta** é cobrada num link próprio da InfinitePay (dentro do app) e vai **100% para o motorista**:
  entra no saldo dele assim que o pagamento é confirmado e sai no saque semanal.
- As **sugestões** só aparecem no App Admin (Avaliações e sugestões). O motorista vê apenas a média das
  notas e o total de gorjetas.

## Formas de pagamento

Pix ou cartão à vista. Com a `INFINITEPAY_API_KEY` cadastrada como secret na Cloudflare, o servidor
gera os links com `payment_methods_enabled: ['pix','credit_card']` e `assured_installments: 0`. A
InfinitePay não permite desligar o parcelamento no checkout; com essa opção, se o cliente escolher
parcelar, os juros ficam por conta dele e você recebe o valor cheio.

## Serviços (app do cliente)

| Serviço | Coleta → destino | Quem confirma (libera o pagamento) |
|---|---|---|
| 🛍️ Estou com as compras | mercado/padaria/farmácia/gás → casa | cliente, quando o motorista chega à coleta |
| 🚗 Quero ir até lá | casa (ou GPS) → loja | cliente, quando o motorista chega |
| 📦 Só buscar minhas compras | loja → casa (cliente informa o que retirar) | cliente, ao **receber** em casa |
| 📮 Buscar uma encomenda | endereço completo → casa (o que é) | cliente, ao **receber** |
| 🔧 Carro na oficina | casa ⇄ trabalho / mecânico, **vários dias com ida e volta num pagamento só** | cliente, a cada viagem |
| 🛞 Borracharia | onde está o carro → borracharia → volta (leva e traz; não ajuda na troca) | cliente, quando o motorista chega |

- Preço de todos: percurso coleta → destino → coleta (o motorista volta), com as tarifas Uber/99, margem
  e urgência do Admin. Borracharia soma a espera (`esperaBorrachariaMin`, padrão 20 min).
- **Locais** (mercados, padarias, farmácias, gás e bebidas, mecânicos, borracharias): App Admin → Locais.
  A lista inicial veio do OpenStreetMap; confira. O cliente também pode digitar outro endereço e marcar no
  mapa (fora de Guaramirim é recusado).
- Só buscar / encomenda: o motorista toca "Cheguei" (GPS) na coleta, "Retirei", "Cheguei no destino"
  (GPS) e o cliente confirma o recebimento. Se o cliente não confirmar em 10 min, o motorista conclui e o
  Admin recebe um aviso.
