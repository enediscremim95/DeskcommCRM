import { z } from "zod";
import { offsetEmMinutos, partesNoFuso } from "@/lib/agenda/fuso";

const HORA = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/;
export const FOLLOWUP_DEFERRED = "followup_deferred:";
export const HORA_MS = 3_600_000;

export const sendWindowSchema = z.strictObject({
  timezone: z.string().max(100).refine((timezone) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: timezone });
      return !/^[+-]/.test(timezone);
    } catch {
      return false;
    }
  }, "Informe um fuso IANA válido."),
  start: z.string().regex(HORA),
  end: z.string().regex(HORA),
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7)
    .refine((days) => new Set(days).size === days.length, "Os dias da semana devem ser únicos."),
}).refine((window) => window.end > window.start, {
  path: ["end"],
  message: "O fim deve ser posterior ao início no mesmo dia.",
});

export type SendWindow = z.infer<typeof sendWindowSchema>;

export function temJanelaDoFluxo(config: unknown): config is { send_window: unknown } {
  return typeof config === "object" && config !== null && "send_window" in config;
}

export function lerJanelaDoFluxo(config: unknown): SendWindow | undefined {
  return temJanelaDoFluxo(config) ? sendWindowSchema.parse(config.send_window) : undefined;
}

function minutos(hora: string): number {
  return Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3));
}

const MINUTO_MS = 60_000;
const DIA_MS = 24 * HORA_MS;

function offsetMs(instant: number, timezone: string): number {
  return offsetEmMinutos(new Date(instant), timezone) * MINUTO_MS;
}

/** Intersecta a hora de parede com cada trecho de offset real do dia. */
function* periodosDoDia(dia: number, window: SendWindow) {
  const inicio = dia + minutos(window.start) * MINUTO_MS;
  const fim = dia + minutos(window.end) * MINUTO_MS;
  const primeiro = dia - DIA_MS;
  const ultimo = dia + 2 * DIA_MS;
  const anterior = offsetMs(primeiro, window.timezone);
  const posterior = offsetMs(ultimo, window.timezone);

  if (anterior === posterior) {
    yield { inicio: inicio - anterior, fim: fim - anterior };
    return;
  }

  // Localiza o salto do relógio nesse dia. Uma hora repetida pode contribuir
  // dois trechos. Uma hora pulada contribui apenas onde o relógio existiu.
  let antes = primeiro;
  let depois = ultimo;
  while (depois - antes > 1000) {
    const meio = Math.floor((antes + depois) / 2000) * 1000;
    if (offsetMs(meio, window.timezone) === anterior) antes = meio;
    else depois = meio;
  }
  const trechos = [
    { inicio: inicio - anterior, fim: Math.min(fim - anterior, depois) },
    { inicio: Math.max(inicio - posterior, depois), fim: fim - posterior },
  ];
  for (const trecho of trechos) {
    if (trecho.inicio < trecho.fim) yield trecho;
  }
}

function* periodosAPartir(window: SendWindow, agora: Date) {
  const { ano, mes, dia } = partesNoFuso(agora, window.timezone);
  for (let data = Date.UTC(ano, mes - 1, dia); ; data += DIA_MS) {
    if (!window.weekdays.includes(new Date(data).getUTCDay())) continue;
    for (const periodo of periodosDoDia(data, window)) {
      if (periodo.fim > agora.getTime()) yield periodo;
    }
  }
}

/** Mantém o instante quando aberto. A borda de fechamento é exclusiva. */
export function alinharJanela(window: SendWindow | undefined, agora: Date): Date {
  if (!window) return agora;
  for (const periodo of periodosAPartir(window, agora)) {
    return periodo.inicio <= agora.getTime() ? agora : new Date(periodo.inicio);
  }
  throw new Error("followup_send_window_unavailable");
}

export function somarHorasUteis(window: SendWindow | undefined, agora: Date, hours: number): Date {
  let restante = hours * HORA_MS;
  // Permite retirar a configuração do pointer enquanto versões publicadas ainda estão em uso.
  if (!window) return new Date(agora.getTime() + restante);
  for (const periodo of periodosAPartir(window, agora)) {
    const inicio = Math.max(periodo.inicio, agora.getTime());
    const disponivel = periodo.fim - inicio;
    if (restante < disponivel) return new Date(inicio + restante);
    restante -= disponivel;
  }
  throw new Error("followup_send_window_unavailable");
}
