import { afterEach, describe, expect, it, vi } from "vitest";

import {
  motivoParaDescartarFila,
  processarItemFilaPrimeiraMensagem,
  type RuntimeFilaPrimeiraMensagem,
  type SnapshotGuardaFila,
  type TurnoFila,
} from "./fila-primeira-mensagem.handler";
import {
  acaoUsaFilaPrimeiraMensagem,
  type ItemFilaPrimeiraMensagem,
} from "./fila-primeira-mensagem";

const NOW = new Date("2026-10-28T15:00:00.000Z");

function item(id = "fila-1"): ItemFilaPrimeiraMensagem {
  return {
    id,
    organization_id: "org-1",
    channel_session_id: "canal-1",
    original_event_id: `evento-${id}`,
    queue_event_id: `evento-fila-${id}`,
    rule_id: "regra-1",
    action_index: 0,
    contact_id: "contato-1",
    conversation_id: "conversa-1",
    action_config: { fila: "primeira_mensagem" },
    status: "queued",
    discard_reason: null,
    outbound_message_id: null,
    next_attempt_at: null,
    enqueued_at: "2026-10-28T14:00:00.000Z",
    started_at: null,
    finished_at: null,
  };
}

function snapshot(overrides: Partial<SnapshotGuardaFila> = {}): SnapshotGuardaFila {
  return {
    tags: [],
    isBlocked: false,
    forceHuman: false,
    latestInboundBody: "Olá",
    latestInboundAt: "2026-10-28T14:30:00.000Z",
    humanRepliedAfterQueue: false,
    conversation: {
      status: "open",
      assignedToUserId: null,
      assigneeKind: null,
      botSilencedUntil: null,
    },
    ...overrides,
  };
}

function turno(decision: TurnoFila["decision"], retryAt: string | null = null): TurnoFila {
  return { decision, retry_at: retryAt, next_day_start: null };
}

function runtime(decisions: TurnoFila[]): RuntimeFilaPrimeiraMensagem & {
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    now: () => new Date(),
    foraDaJanela: vi.fn(async () => null),
    turno: vi.fn(async (_item, claim) => {
      calls.push(claim ? "claim" : "peek");
      return decisions.shift() ?? turno("ready");
    }),
    snapshot: vi.fn(async () => snapshot()),
    descartar: vi.fn(async (_item, reason) => void calls.push(`discard:${reason}`)),
    enviar: vi.fn(async () => {
      calls.push("send");
      return {
        type: "send_whatsapp_message",
        status: "success" as const,
        detail: { message_id: "m-1" },
      };
    }),
    acompanharMensagem: vi.fn(async () => null),
    finalizar: vi.fn(async () => void calls.push("finish")),
    reagendar: vi.fn(async (_item, at) => void calls.push(`retry:${at}`)),
    proximaAberturaDoDiaSeguinte: vi.fn(async () => "2026-10-29T12:00:00.000Z"),
    acordarOrigem: vi.fn(async () => void calls.push("wake")),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("fila da primeira mensagem", () => {
  it("continua opt-in e ignora ações sem o marcador exato", () => {
    expect(acaoUsaFilaPrimeiraMensagem({})).toBe(false);
    expect(acaoUsaFilaPrimeiraMensagem({ fila: "outra_fila" })).toBe(false);
    expect(acaoUsaFilaPrimeiraMensagem({ fila: "primeira_mensagem" })).toBe(true);
  });

  it("mantém FIFO quando o item ainda não é a cabeça", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const r = runtime([turno("not_head", "2026-10-28T15:00:30.000Z")]);

    const result = await processarItemFilaPrimeiraMensagem(r, item("segundo"));

    expect(result).toMatchObject({ status: "retry", detail: "not_head" });
    expect(r.calls).toEqual(["peek", "retry:2026-10-28T15:00:30.000Z"]);
  });

  it.each([120, 240])("respeita a borda de %i segundos entre inícios", async (seconds) => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const retryAt = new Date(NOW.getTime() + seconds * 1_000).toISOString();
    const r = runtime([turno("interval", retryAt)]);

    const result = await processarItemFilaPrimeiraMensagem(r, item());

    expect(result).toMatchObject({ status: "retry", retry_at: retryAt });
    expect(r.enviar).not.toHaveBeenCalled();
  });

  it("adia o teto diário para a próxima abertura do canal", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const r = runtime([
      { decision: "daily_limit", retry_at: null, next_day_start: "2026-10-29T03:00:00.000Z" },
    ]);

    const result = await processarItemFilaPrimeiraMensagem(r, item());

    expect(r.proximaAberturaDoDiaSeguinte).toHaveBeenCalledWith(
      expect.objectContaining({ id: "fila-1" }),
      "2026-10-29T03:00:00.000Z",
    );
    expect(result).toMatchObject({ status: "retry", retry_at: "2026-10-29T12:00:00.000Z" });
  });

  it("pausa e retoma o mesmo item sem perdê-lo", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const queued = item();
    const paused = runtime([turno("paused", "2026-10-28T15:01:00.000Z")]);
    await processarItemFilaPrimeiraMensagem(paused, queued);
    expect(paused.enviar).not.toHaveBeenCalled();

    vi.setSystemTime(new Date("2026-10-28T15:01:00.000Z"));
    const resumed = runtime([turno("ready"), turno("claimed")]);
    const result = await processarItemFilaPrimeiraMensagem(resumed, queued);

    expect(result.status).toBe("ok");
    expect(resumed.calls).toEqual(["peek", "claim", "send", "finish", "wake"]);
  });

  it.each([
    [["nao_contatar"], "tag_nao_contatar"],
    [["sem_followup"], "tag_sem_followup"],
  ])("descarta a tag %s", (tags, expected) => {
    expect(motivoParaDescartarFila(snapshot({ tags: tags as string[] }), NOW)).toBe(expected);
  });

  it("descarta quando a última entrada passou de 23 horas", () => {
    expect(
      motivoParaDescartarFila(
        snapshot({ latestInboundAt: "2026-10-27T15:59:59.999Z" }),
        NOW,
      ),
    ).toBe("janela_24h_expirada");
  });

  it("descarta quando a mensagem recebida pede para não incomodar", () => {
    expect(
      motivoParaDescartarFila(snapshot({ latestInboundBody: "Não quero mais receber mensagens" }), NOW),
    ).toBe("pedido_opt_out");
  });

  it.each([
    [{ humanRepliedAfterQueue: true }, "humano_respondeu"],
    [{ conversation: { ...snapshot().conversation, assignedToUserId: "user-1" } }, "conversa_atribuida"],
    [{ conversation: { ...snapshot().conversation, botSilencedUntil: "2026-10-29T15:00:00.000Z" } }, "ia_pausada"],
  ])("descarta quando um humano assumiu: %s", (override, expected) => {
    expect(motivoParaDescartarFila(snapshot(override as Partial<SnapshotGuardaFila>), NOW)).toBe(expected);
  });
});
