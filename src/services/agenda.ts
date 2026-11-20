// Regras de horário do frete (puras, sem dependências): usadas pelo servidor e testadas com node --test.
// Guaramirim usa o horário de Brasília (UTC-3, sem horário de verão).

export const FUSO_MIN = -180; // UTC-3

export type ConfigAgenda = {
  aberto: boolean; // aceitando pedidos
  bloqueioMin: number; // tempo de ir ao cliente e voltar ao mercado (padrão 40)
  passoMin: number; // intervalo entre horários oferecidos
  horaInicio: string; // "08:00"
  horaFim: string; // "19:00" (último atendimento termina até aqui)
  antecedenciaMin: number; // agendamento com pelo menos X min de antecedência
};

export const AGENDA_PADRAO: ConfigAgenda = {
  aberto: true,
  bloqueioMin: 40,
  passoMin: 20,
  horaInicio: '08:00',
  horaFim: '19:00',
  antecedenciaMin: 30,
};

export type Bloco = { inicio: number; fim: number }; // ms (UTC)

const MIN = 60_000;
const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

const minutos = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
};

/** Data local (YYYY-MM-DD) de um instante. */
export function dataLocal(ms: number): string {
  return new Date(ms + FUSO_MIN * MIN).toISOString().slice(0, 10);
}

/** Instante (ms UTC) de uma data local + minutos do dia. */
export function instante(data: string, minutosDoDia: number): number {
  const [a, m, d] = data.split('-').map(Number);
  return Date.UTC(a, m - 1, d) + (minutosDoDia - FUSO_MIN) * MIN;
}

export function horaLocal(ms: number): string {
  return new Date(ms + FUSO_MIN * MIN).toISOString().slice(11, 16);
}

export function rotuloDia(data: string, hoje: string): string {
  const [a, m, d] = data.split('-').map(Number);
  const dd = `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
  const amanha = dataLocal(instante(hoje, 0) + 24 * 60 * MIN);
  if (data === hoje) return `Hoje ${dd}`;
  if (data === amanha) return `Amanhã ${dd}`;
  return `${SEMANA[new Date(Date.UTC(a, m - 1, d)).getUTCDay()]} ${dd}`;
}

const sobrepoe = (a: Bloco, b: Bloco) => a.inicio < b.fim && b.inicio < a.fim;

/** Horários livres (início em ms) de um dia: cada atendimento ocupa `bloqueioMin`. */
export function horariosLivres(data: string, cfg: ConfigAgenda, ocupados: Bloco[], agora: number): number[] {
  const ini = minutos(cfg.horaInicio), fim = minutos(cfg.horaFim);
  const livres: number[] = [];
  for (let t = ini; t + cfg.bloqueioMin <= fim; t += cfg.passoMin) {
    const s = instante(data, t);
    if (s < agora + cfg.antecedenciaMin * MIN) continue;
    const bloco = { inicio: s, fim: s + cfg.bloqueioMin * MIN };
    if (!ocupados.some((o) => sobrepoe(o, bloco))) livres.push(s);
  }
  return livres;
}

/** Pode pedir "agora"? Aberto, dentro do horário e sem nada nos próximos `bloqueioMin`. */
export function agoraDisponivel(cfg: ConfigAgenda, ocupados: Bloco[], agora: number): { ok: boolean; motivo?: string } {
  if (!cfg.aberto) return { ok: false, motivo: 'Não estamos aceitando pedidos no momento.' };
  const hoje = dataLocal(agora);
  if (agora < instante(hoje, minutos(cfg.horaInicio)) || agora + cfg.bloqueioMin * MIN > instante(hoje, minutos(cfg.horaFim)))
    return { ok: false, motivo: `Atendimento das ${cfg.horaInicio} às ${cfg.horaFim}.` };
  const bloco = { inicio: agora, fim: agora + cfg.bloqueioMin * MIN };
  const conflito = ocupados.find((o) => sobrepoe(o, bloco));
  if (conflito) return { ok: false, motivo: `Ocupado agora. Livre a partir das ${horaLocal(conflito.fim)}.` };
  return { ok: true };
}

/** Confere se um horário escolhido ainda está livre (antes de reservar). */
export function horarioValido(inicio: number, cfg: ConfigAgenda, ocupados: Bloco[], agora: number): boolean {
  if (!cfg.aberto) return false;
  return horariosLivres(dataLocal(inicio), cfg, ocupados, agora).includes(inicio);
}

/** Próximos dias com horários livres. */
export function proximosDias(cfg: ConfigAgenda, ocupados: Bloco[], agora: number, dias = 6) {
  const hoje = dataLocal(agora);
  const out: { data: string; rotulo: string; horarios: { inicio: string; hora: string }[] }[] = [];
  if (!cfg.aberto) return out;
  for (let i = 0; i < dias + 2 && out.length < dias; i++) {
    const data = dataLocal(instante(hoje, 12 * 60) + i * 24 * 60 * MIN);
    const livres = horariosLivres(data, cfg, ocupados, agora);
    if (livres.length)
      out.push({ data, rotulo: rotuloDia(data, hoje), horarios: livres.map((s) => ({ inicio: new Date(s).toISOString(), hora: horaLocal(s) })) });
  }
  return out;
}
