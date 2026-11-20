// Coloca cada frete pago na agenda do celular (Google Agenda no Android, Calendário no iPhone),
// com lembrete 15 minutos antes. Frete cancelado sai da agenda.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Calendar from 'expo-calendar/legacy';
import { createContext, createElement, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import type { PedidoAdmin } from '../services/admin';
import { formatarReais } from '../services/preco';

const K_CAL = 'agenda:calendario';
const K_ATIVO = 'agenda:ativo';
const K_EVENTOS = 'agenda:eventos';

export type CalendarioOpcao = { id: string; titulo: string; conta: string };

async function lerEventos(): Promise<Record<string, string>> {
  try {
    return JSON.parse((await AsyncStorage.getItem(K_EVENTOS)) ?? '{}');
  } catch {
    return {};
  }
}

async function calendariosGravaveis(): Promise<CalendarioOpcao[]> {
  const todos = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  return todos
    .filter((c) => c.allowsModifications)
    .sort((a, b) => Number(!!b.isPrimary) - Number(!!a.isPrimary))
    .map((c) => ({ id: c.id, titulo: c.title, conta: c.source?.name ?? '' }));
}

async function calendarioPadrao(): Promise<string | null> {
  if (Platform.OS === 'ios') return (await Calendar.getDefaultCalendarAsync()).id;
  const lista = await calendariosGravaveis();
  // No Android, prefira a agenda da conta Google (sincroniza com o Google Agenda).
  return (lista.find((c) => /@gmail\.com|google/i.test(c.conta)) ?? lista[0])?.id ?? null;
}

export function useAgendaCelular() {
  const [ativo, setAtivoState] = useState(true);
  const [calId, setCalIdState] = useState<string | null>(null);
  const [opcoes, setOpcoes] = useState<CalendarioOpcao[]>([]);
  const [ultima, setUltima] = useState<{ quando: Date; erro?: string } | null>(null);

  useEffect(() => {
    (async () => {
      const [a, c] = await Promise.all([AsyncStorage.getItem(K_ATIVO), AsyncStorage.getItem(K_CAL)]);
      setAtivoState(a !== 'nao');
      setCalIdState(c);
    })();
  }, []);

  const setAtivo = useCallback(async (v: boolean) => {
    setAtivoState(v);
    await AsyncStorage.setItem(K_ATIVO, v ? 'sim' : 'nao');
  }, []);
  const setCalId = useCallback(async (id: string) => {
    setCalIdState(id);
    await AsyncStorage.setItem(K_CAL, id);
  }, []);

  const carregarOpcoes = useCallback(async () => {
    const { status } = await Calendar.requestCalendarPermissionsAsync();
    if (status !== 'granted') throw new Error('Permita o acesso à agenda nas configurações do celular.');
    setOpcoes(await calendariosGravaveis());
  }, []);

  const sincronizar = useCallback(
    async (lista: PedidoAdmin[]) => {
      if (!ativo) return;
      try {
        const { status } = await Calendar.requestCalendarPermissionsAsync();
        if (status !== 'granted') throw new Error('Sem permissão para a agenda.');
        let cal = calId;
        if (!cal) {
          cal = await calendarioPadrao();
          if (!cal) throw new Error('Nenhuma agenda disponível no celular.');
          await setCalId(cal);
        }
        const eventos = await lerEventos();
        const agora = Date.now();
        for (const p of lista) {
          const ev = eventos[p.orderNsu];
          if (p.status === 'cancelado' && ev) {
            await Calendar.deleteEventAsync(ev).catch(() => {});
            delete eventos[p.orderNsu];
          } else if (p.status === 'pago' && !ev && Date.parse(p.fim) > agora) {
            eventos[p.orderNsu] = await Calendar.createEventAsync(cal, {
              title: `${p.agendado ? '' : '🚨 '}Frete ${p.mercadoNome} → ${p.cliente.nome || 'cliente'}`,
              startDate: new Date(p.inicio),
              endDate: new Date(p.fim),
              location: p.cliente.endereco,
              notes: `${formatarReais(p.valor)} · Tel: ${p.cliente.telefone ?? '-'}\nhttps://www.google.com/maps/search/?api=1&query=${p.cliente.lat},${p.cliente.lon}`,
              alarms: [{ relativeOffset: -15 }],
              timeZone: 'America/Sao_Paulo',
            });
          }
        }
        await AsyncStorage.setItem(K_EVENTOS, JSON.stringify(eventos));
        setUltima({ quando: new Date() });
      } catch (e) {
        setUltima({ quando: new Date(), erro: (e as Error).message });
      }
    },
    [ativo, calId, setCalId],
  );

  return { ativo, setAtivo, calId, setCalId, opcoes, carregarOpcoes, sincronizar, ultima };
}

// Compartilhado entre o painel e os ajustes do App Admin.
type AgendaCtx = ReturnType<typeof useAgendaCelular>;
const Ctx = createContext<AgendaCtx | null>(null);

export function AgendaProvider({ children }: { children: ReactNode }) {
  const valor = useAgendaCelular();
  return createElement(Ctx.Provider, { value: valor }, children);
}

export function useAgenda() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAgenda fora do AgendaProvider');
  return c;
}
