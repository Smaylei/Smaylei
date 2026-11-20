import type { EventoAgenda } from '../hooks/useAgendaCelular';
import type { CorridaMotorista } from './api';
import { formatarReais } from './preco';

/** Corridas aceitas pelo motorista → eventos da agenda do celular. */
export function eventosDaAgenda(lista: CorridaMotorista[]): EventoAgenda[] {
  return lista.map((c) => ({
    id: c.id,
    cancelado: c.status === 'cancelado',
    inicio: c.inicio,
    fim: c.fim,
    titulo: `${c.agendado ? '' : '🚨 '}Frete ${c.mercado?.nome ?? ''} → ${c.cliente?.nome ?? 'cliente'}`,
    local: c.mercado ? `${c.mercado.nome}, ${c.mercado.endereco}` : '',
    notas: `Entregar em: ${c.cliente?.endereco ?? '-'}\nGanho: ${formatarReais(c.ganho)}\nTel: ${c.cliente?.telefone ?? '-'}`,
  }));
}

