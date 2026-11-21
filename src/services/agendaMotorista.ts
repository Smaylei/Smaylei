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
    titulo: `${c.agendado ? '' : '🚨 '}${c.servicoTitulo ?? 'Frete'}: ${c.coleta?.nome ?? c.mercado?.nome ?? ''} → ${c.entrega?.nome === 'Casa' ? (c.cliente?.nome ?? 'cliente') : (c.entrega?.nome ?? c.cliente?.nome ?? '')}`,
    local: c.coleta ? `${c.coleta.nome}, ${c.coleta.endereco}` : c.mercado ? `${c.mercado.nome}, ${c.mercado.endereco}` : '',
    notas: `Destino: ${c.entrega?.endereco ?? c.cliente?.endereco ?? '-'}${c.descricao ? `\nO que: ${c.descricao}` : ''}\nGanho: ${formatarReais(c.ganho)}`,
  }));
}

