// Utilidades comuns do servidor (respostas JSON, datas, dinheiro, ids).
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, authorization',
  'access-control-allow-methods': 'GET,POST,PUT,DELETE',
};
export const json = (d: unknown, status = 200) =>
  new Response(JSON.stringify(d), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...CORS } });
export const erro = (mensagem: string, status = 400) => json({ erro: mensagem }, status);
export const brl = (v: number) => 'R$ ' + Number(v).toFixed(2).replace('.', ',');
export const iso = (ms: number) => new Date(ms).toISOString();
export const r2 = (v: number) => Math.round(v * 100) / 100;
export const novoId = (p: string) => `${p}-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 6)}`;
export const soDigitos = (s: unknown) => String(s ?? '').replace(/\D/g, '');
export const MIN = 60_000;
export const DIA = 24 * 60 * MIN;
export type Linha = Record<string, string | number | null>;
