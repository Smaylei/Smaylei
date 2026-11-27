// Chave Pix informada pelo motorista/loja para receber: valida e padroniza conforme o tipo.
import { cpfValido } from './cpf';

export type TipoChavePix = 'cpf' | 'cnpj' | 'celular' | 'email' | 'aleatoria';
export const TIPOS_CHAVE_PIX: { id: TipoChavePix; nome: string }[] = [
  { id: 'cpf', nome: 'CPF' },
  { id: 'cnpj', nome: 'CNPJ' },
  { id: 'celular', nome: 'Celular' },
  { id: 'email', nome: 'E-mail' },
  { id: 'aleatoria', nome: 'Aleatória' },
];

export const nomeTipoChave = (t: unknown) => TIPOS_CHAVE_PIX.find((x) => x.id === t)?.nome ?? 'Chave';

/** Chave padronizada (como o banco espera) e o tipo, ou null se não for válida. Sem tipo, deduz pelo formato. */
export function chavePixValida(tipo: unknown, valor: unknown): { tipo: TipoChavePix; chave: string } | null {
  const t = String(valor ?? '').trim();
  const d = t.replace(/\D/g, '');
  const tp = TIPOS_CHAVE_PIX.some((x) => x.id === tipo) ? (tipo as TipoChavePix) : adivinhar(t);
  const ok = (chave: string | null) => (chave && tp ? { tipo: tp, chave } : null);
  if (tp === 'cpf') return ok(d.length === 11 && cpfValido(d) ? d : null);
  if (tp === 'cnpj') return ok(d.length === 14 && !/^(\d)\1{13}$/.test(d) ? d : null);
  if (tp === 'celular') {
    const n = d.length === 13 && d.startsWith('55') ? d.slice(2) : d;
    return ok(n.length === 11 || n.length === 10 ? `+55${n}` : null);
  }
  if (tp === 'email') return ok(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t) && t.length <= 77 ? t.toLowerCase() : null);
  if (tp === 'aleatoria') return ok(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t) ? t.toLowerCase() : null);
  return null;
}

/** Como mostrar a chave (CPF/CNPJ/celular formatados). */
export function mostrarChavePix(chave: unknown): string {
  const t = String(chave ?? '');
  const d = t.replace(/\D/g, '');
  if (/^\d{11}$/.test(t)) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (/^\d{14}$/.test(t)) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  if (/^\+55\d{10,11}$/.test(t)) return t.replace(/^\+55(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3');
  return t;
}

function adivinhar(t: string): TipoChavePix | undefined {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(t)) return 'aleatoria';
  if (t.includes('@')) return 'email';
  const d = t.replace(/\D/g, '');
  if (t.startsWith('+') || t.includes('(')) return 'celular';
  if (d.length === 14) return 'cnpj';
  if (d.length === 11 && cpfValido(d)) return 'cpf';
  if (d.length === 10 || d.length === 11) return 'celular';
  return undefined;
}
