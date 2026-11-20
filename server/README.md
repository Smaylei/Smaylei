# Servidor de pagamentos (InfinitePay)

Cloudflare Worker que faz a parte do pagamento que não pode ficar no app:

| Rota | O que faz |
|---|---|
| `POST /pedidos` | Recalcula o frete (mesmo mapa e tarifas do app), cria o link na InfinitePay com a API Key (`single_payment`, expira em 24 h) e guarda o pedido. |
| `GET /retorno` | Página para onde a InfinitePay manda o cliente após pagar: confirma em `/payment_check` e reabre o app (`mercadofrete://pagamento`). |
| `POST /webhook` | Aviso da InfinitePay. Como não tem assinatura, cada aviso é confirmado em `/payment_check`. |
| `GET /pedidos/:id` | Status do pedido (o app consulta). |
| `GET /admin/pedidos` | Lista de pedidos para a operação (header `Authorization: Bearer <ADMIN_TOKEN>`). |

## Publicar (uma vez)

```bash
cd server
npm install
npx wrangler login                          # conta grátis em cloudflare.com
npx wrangler kv namespace create PEDIDOS    # copie o id para wrangler.toml
npx wrangler secret put INFINITEPAY_API_KEY # cole a API Key (inchk_...) — só aqui
npx wrangler secret put ADMIN_TOKEN         # invente uma senha para ver os pedidos
npx wrangler deploy                         # mostra a URL https://...workers.dev
```

Depois coloque essa URL em `API_PAGAMENTOS` (`src/config.ts`) e gere o app de novo.

## Agenda e avisos

- Cada frete ocupa `bloqueioMin` (padrão 40 min) a partir do horário escolhido (ou do pagamento,
  no urgente). Horários são oferecidos de 20 em 20 min entre `horaInicio` e `horaFim`. Reserva sem
  pagamento segura o horário por 15 min. Cancelado → o horário volta a ficar vago.
- Cliente cancela pelo app: agendado até o horário; urgente até 5 min após pagar.
- `GET /agenda.ics?k=...` (link no App Admin → Ajustes) com lembrete 15 min antes.

### Avisos

Os avisos (pedido pago, aceite, cancelamento, saque, mensagem de cliente, motorista novo) ficam no
App Admin (sino 🔔 no painel) e aparecem como notificação no celular. Não usamos mais WhatsApp.
