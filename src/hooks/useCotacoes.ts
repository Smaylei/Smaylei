import { useEffect, useState } from 'react';
import type { ServicoId, Veiculo } from '../data/servicos';
import { api } from '../services/api';
import { SOLICITANTE } from '../variante';

type Ponto = { lat: number; lon: number };
export type Cotacao = { valor: number; km: number; minutos: number; kmDesloc: number };

const cache = new Map<string, Cotacao | null>();
const chave = (sv: string, ag: boolean, b: Ponto, p: Ponto, extra: string) => `${sv}|${ag ? 1 : 0}|${extra}|${b.lat.toFixed(4)},${b.lon.toFixed(4)}|${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;

/**
 * Preço de cada ponto a partir da base, calculado pelo servidor (rota OSRM + tarifas do Admin):
 * é exatamente o valor que será cobrado no pedido. O preço soma o deslocamento do motorista até a
 * coleta e a viagem da coleta ao destino; `baseEh` diz se a base é a coleta ou o destino.
 */
export function useCotacoes(
  servico: ServicoId,
  agendado: boolean,
  base: Ponto | null | undefined,
  pontos: (Ponto & { id: string })[],
  baseEh: 'coleta' | 'entrega' = 'coleta',
  veiculo: Veiculo = 'carro',
) {
  const [res, setRes] = useState<Record<string, Cotacao | null>>({});
  const extra = `${baseEh}|${veiculo}`;
  const assinatura = base ? `${servico}|${agendado}|${extra}|${base.lat},${base.lon}|${pontos.map((p) => `${p.id}:${p.lat},${p.lon}`).join(';')}` : '';

  useEffect(() => {
    if (!base || !pontos.length) return;
    let vivo = true;
    const prontos: Record<string, Cotacao | null> = {};
    const faltam = pontos.filter((p) => {
      const k = chave(servico, agendado, base, p, extra);
      if (cache.has(k)) prontos[p.id] = cache.get(k)!;
      return !cache.has(k);
    });
    const t = setTimeout(() => {
      if (vivo) setRes(prontos);
      if (!faltam.length) return;
      api<Record<string, Cotacao>>(SOLICITANTE, '/v2/cotacoes', { method: 'POST', corpo: { servico, agendado, base, baseEh, veiculo, pontos: faltam } })
        .then((r) => {
          for (const p of faltam) cache.set(chave(servico, agendado, base, p, extra), r[p.id] ?? null);
          if (vivo) setRes((a) => ({ ...a, ...Object.fromEntries(faltam.map((p) => [p.id, r[p.id] ?? null])) }));
        })
        .catch(() => {});
    }, 200);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assinatura]);

  return base ? res : {};
}
