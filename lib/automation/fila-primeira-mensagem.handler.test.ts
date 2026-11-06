import { afterEach, describe, expect, it, vi } from "vitest";

import { CHANNEL_CAPABILITIES, type ProviderDeMensagem } from "@/lib/channels";
import {
  carregarPoliticaEsperaFila,
  haConversaHumanaEmAndamentoNoCanal,
  motivoParaDescartarFila,
  politicaEsperaFilaPorCanal,
  processarItemFilaPrimeiraMensagem,
  type PoliticaEsperaFila,
  type RuntimeFilaPrimeiraMensagem,
  type SnapshotGuardaFila,
  type TurnoFila,
} from "./fila-primeira-mensagem.handler";
import {
  acaoUsaFilaPrimeiraMensagem,
  idDaBolhaFilaPrimeiraMensagem,
  pausaEntreBolhasSegundos,
  resultadoDaFila,
  type ItemFilaPrimeiraMensagem,
} from "./fila-primeira-mensagem";

const NOW = new Date("2026-10-28T15:00:00.000Z");
const PROVIDER_COM_JANELA = Object.entries(CHANNEL_CAPABILITIES).find(
  ([, capabilities]) => !capabilities.freeformOutsideWindow,
)?.[0] as ProviderDeMensagem;
const PROVIDER_SEM_JANELA = Object.entries(CHANNEL_CAPABILITIES).find(
  ([, capabilities]) => capabilities.freeformOutsideWindow,
)?.[0] as ProviderDeMensagem;

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
    action_config: { fila: "primeira_mensagem", template: "Olá" },
    status: "queued",
    discard_reason: null,
    outbound_message_id: null,
    outbound_message_ids: [],
    message_parts: null,
    sent_part_count: 0,
    next_attempt_at: null,
    enqueued_at: "2026-10-28T14:00:00.000Z",
    started_at: null,
    finished_at: null,
  };
}

function snapshot(overrides: Partial<SnapshotGuardaFila> = {}): SnapshotGuardaFila {
  return {
    ruleActive: true,
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

function runtime(
  decisions: TurnoFila[],
  options: { now?: Date; politica?: PoliticaEsperaFila } = {},
): RuntimeFilaPrimeiraMensagem & {
  calls: string[];
} {
  const calls: string[] = [];
  const politica = options.politica ?? politicaEsperaFilaPorCanal(PROVIDER_COM_JANELA, null);
  return {
    calls,
    now: () => new Date(options.now ?? NOW),
    foraDaJanela: vi.fn(async () => null),
    turno: vi.fn(async (_item, claim) => {
      calls.push(claim ? "claim" : "peek");
      return decisions.shift() ?? turno("ready");
    }),
    politicaEspera: vi.fn(async () => politica),
    ultimaEntradaEm: vi.fn(async () => snapshot().latestInboundAt),
    conversaEmAndamento: vi.fn(async () => false),
    snapshot: vi.fn(async () => snapshot()),
    descartar: vi.fn(async (_item, reason) => void calls.push(`discard:${reason}`)),
    prepararPartes: vi.fn(async (queueItem) => queueItem),
    enviarBolha: vi.fn(async (_queueItem, body, index) => {
      calls.push(`send:${index}:${body}`);
      return {
        type: "send_whatsapp_message",
        status: "success" as const,
        detail: { message_id: `m-${index + 1}` },
      };
    }),
    registrarBolha: vi.fn(async (queueItem, index, result) => {
      calls.push(`part:${index}`);
      if (result.status === "success") queueItem.sent_part_count = index + 1;
      if (typeof result.detail?.message_id === "string") {
        queueItem.outbound_message_ids[index] = result.detail.message_id;
        queueItem.outbound_message_id = result.detail.message_id;
      }
    }),
    acompanharMensagem: vi.fn(async () => null),
    depoisDaPrimeiraBolha: vi.fn(async () => void calls.push("after-first")),
    pausarEntreBolhas: vi.fn(async (milliseconds) => void calls.push(`pause:${milliseconds}`)),
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

  it("deriva uma identidade estável e distinta para cada bolha", () => {
    const primeira = idDaBolhaFilaPrimeiraMensagem("fila-1", 0);
    expect(idDaBolhaFilaPrimeiraMensagem("fila-1", 0)).toBe(primeira);
    expect(idDaBolhaFilaPrimeiraMensagem("fila-1", 1)).not.toBe(primeira);
    expect(primeira).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("usa pausa padrão de três segundos entre bolhas", () => {
    expect(pausaEntreBolhasSegundos(item())).toBe(3);
  });

  it("expõe o desfecho parcial sem esconder as bolhas já enviadas", () => {
    const partial = item();
    partial.status = "failed";
    partial.message_parts = ["Primeira", "Segunda", "Terceira"];
    partial.sent_part_count = 1;
    partial.outbound_message_ids = ["mensagem-1"];
    partial.outbound_message_id = "mensagem-1";
    partial.discard_reason = "partial_send_failed:channel_send_failed";

    expect(resultadoDaFila(partial)).toMatchObject({
      status: "failed",
      error: "partial_send_failed:channel_send_failed",
      detail: {
        partial: true,
        sent_parts: 1,
        total_parts: 3,
        message_ids: ["mensagem-1"],
      },
    });
  });

  it("mantém FIFO quando o item ainda não é a cabeça", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const r = runtime([turno("not_head", "2026-10-28T15:00:30.000Z")]);

    const result = await processarItemFilaPrimeiraMensagem(r, item("segundo"));

    expect(result).toMatchObject({ status: "retry", detail: "not_head" });
    expect(r.calls).toEqual(["peek", "retry:2026-10-28T15:00:30.000Z"]);
  });

  it("reagenda a cabeça ocupada sem descartar nem reivindicar o item", async () => {
    const r = runtime([turno("ready")]);
    vi.mocked(r.conversaEmAndamento).mockResolvedValue(true);

    const result = await processarItemFilaPrimeiraMensagem(r, item("primeiro"));

    expect(result).toMatchObject({
      status: "retry",
      retry_at: "2026-10-28T15:00:25.000Z",
      detail: "aguardando_conversa_em_andamento",
    });
    expect(r.calls).toEqual(["peek", "retry:2026-10-28T15:00:25.000Z"]);
    expect(r.descartar).not.toHaveBeenCalled();
    expect(r.enviarBolha).not.toHaveBeenCalled();
    expect(r.turno).toHaveBeenCalledTimes(1);
  });

  it("envia normalmente quando o canal está livre", async () => {
    const r = runtime([turno("ready"), turno("claimed")]);

    const result = await processarItemFilaPrimeiraMensagem(r, item());

    expect(result).toMatchObject({ status: "ok", detail: "success" });
    expect(r.conversaEmAndamento).toHaveBeenCalledOnce();
    expect(r.enviarBolha).toHaveBeenCalledOnce();
  });

  it("mantém a ordem enquanto a cabeça espera a equipe terminar outra conversa", async () => {
    const primeiro = runtime([turno("ready")]);
    vi.mocked(primeiro.conversaEmAndamento).mockResolvedValue(true);
    const segundo = runtime([turno("not_head", "2026-10-28T15:00:30.000Z")]);

    const espera = await processarItemFilaPrimeiraMensagem(primeiro, item("primeiro"));
    const atras = await processarItemFilaPrimeiraMensagem(segundo, item("segundo"));

    expect(espera).toMatchObject({
      status: "retry",
      detail: "aguardando_conversa_em_andamento",
    });
    expect(atras).toMatchObject({ status: "retry", detail: "not_head" });
    expect(primeiro.enviarBolha).not.toHaveBeenCalled();
    expect(segundo.enviarBolha).not.toHaveBeenCalled();
    expect(segundo.conversaEmAndamento).not.toHaveBeenCalled();
  });

  it.each([120, 240])("respeita a borda de %i segundos entre inícios", async (seconds) => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const retryAt = new Date(NOW.getTime() + seconds * 1_000).toISOString();
    const r = runtime([turno("interval", retryAt)]);

    const result = await processarItemFilaPrimeiraMensagem(r, item());

    expect(result).toMatchObject({ status: "retry", retry_at: retryAt });
    expect(r.enviarBolha).not.toHaveBeenCalled();
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

  it("envia no próximo expediente o item sem janela oficial que bateu o teto diário", async () => {
    const sabado = new Date("2026-10-31T17:30:00.000Z");
    const segunda = new Date("2026-11-02T12:00:00.000Z");
    const politica = politicaEsperaFilaPorCanal(PROVIDER_SEM_JANELA, null);
    const queued = item();
    queued.enqueued_at = sabado.toISOString();

    const lotado = runtime(
      [{ decision: "daily_limit", retry_at: null, next_day_start: "2026-11-01T03:00:00.000Z" }],
      { now: sabado, politica },
    );
    vi.mocked(lotado.proximaAberturaDoDiaSeguinte).mockResolvedValue(segunda.toISOString());
    vi.mocked(lotado.ultimaEntradaEm).mockResolvedValue(sabado.toISOString());

    await expect(processarItemFilaPrimeiraMensagem(lotado, queued)).resolves.toMatchObject({
      status: "retry",
      retry_at: segunda.toISOString(),
      detail: "daily_limit",
    });

    const retomado = runtime([turno("ready"), turno("claimed")], {
      now: segunda,
      politica,
    });
    vi.mocked(retomado.snapshot).mockResolvedValue(
      snapshot({ latestInboundAt: sabado.toISOString() }),
    );
    vi.mocked(retomado.ultimaEntradaEm).mockResolvedValue(sabado.toISOString());

    await expect(processarItemFilaPrimeiraMensagem(retomado, queued)).resolves.toMatchObject({
      status: "ok",
      detail: "success",
    });
    expect(retomado.descartar).not.toHaveBeenCalled();
    expect(retomado.enviarBolha).toHaveBeenCalledOnce();
  });

  it.each(["horário fechado", "teto diário"])(
    "descarta a espera máxima antes de reagendar por %s",
    async (bloqueio) => {
      const now = new Date("2026-11-03T18:00:00.000Z");
      const politica = politicaEsperaFilaPorCanal(PROVIDER_SEM_JANELA, null);
      const r = runtime(
        bloqueio === "teto diário"
          ? [
              {
                decision: "daily_limit",
                retry_at: null,
                next_day_start: "2026-11-04T03:00:00.000Z",
              },
            ]
          : [],
        { now, politica },
      );
      vi.mocked(r.ultimaEntradaEm).mockResolvedValue(
        new Date(now.getTime() - 73 * 60 * 60 * 1_000).toISOString(),
      );
      if (bloqueio === "horário fechado") {
        vi.mocked(r.foraDaJanela).mockResolvedValue("2026-11-04T12:00:00.000Z");
      }

      await expect(processarItemFilaPrimeiraMensagem(r, item())).resolves.toMatchObject({
        status: "ok",
        detail: "espera_maxima_excedida",
      });
      expect(r.descartar).toHaveBeenCalledWith(
        expect.objectContaining({ id: "fila-1" }),
        "espera_maxima_excedida",
      );
      expect(r.foraDaJanela).not.toHaveBeenCalled();
      expect(r.turno).not.toHaveBeenCalled();
      expect(r.enviarBolha).not.toHaveBeenCalled();
    },
  );

  it("pausa e retoma o mesmo item sem perdê-lo", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const queued = item();
    const paused = runtime([turno("paused", "2026-10-28T15:01:00.000Z")]);
    await processarItemFilaPrimeiraMensagem(paused, queued);
    expect(paused.enviarBolha).not.toHaveBeenCalled();

    vi.setSystemTime(new Date("2026-10-28T15:01:00.000Z"));
    const resumed = runtime([turno("ready"), turno("claimed")]);
    const result = await processarItemFilaPrimeiraMensagem(resumed, queued);

    expect(result.status).toBe("ok");
    expect(resumed.calls).toEqual([
      "peek",
      "claim",
      "send:0:Olá",
      "part:0",
      "after-first",
      "finish",
      "wake",
    ]);
  });

  it("envia três bolhas em ordem e pausa entre elas", async () => {
    const queued = item();
    queued.message_parts = ["Primeira", "Segunda", "Terceira"];
    queued.action_config = {
      fila: "primeira_mensagem",
      pausa_entre_bolhas_segundos: 4,
    };
    const r = runtime([turno("ready"), turno("claimed")]);

    const result = await processarItemFilaPrimeiraMensagem(r, queued);

    expect(result).toMatchObject({ status: "ok", detail: "success" });
    expect(r.calls).toEqual([
      "peek",
      "claim",
      "send:0:Primeira",
      "part:0",
      "after-first",
      "pause:4000",
      "send:1:Segunda",
      "part:1",
      "pause:4000",
      "send:2:Terceira",
      "part:2",
      "finish",
      "wake",
    ]);
  });

  it("para antes da segunda bolha quando um humano responde no meio", async () => {
    const queued = item();
    queued.message_parts = ["Primeira", "Segunda", "Terceira"];
    const r = runtime([turno("ready"), turno("claimed")]);
    vi.mocked(r.snapshot)
      .mockResolvedValueOnce(snapshot())
      .mockResolvedValueOnce(snapshot())
      .mockResolvedValueOnce(snapshot({ humanRepliedAfterQueue: true }));

    const result = await processarItemFilaPrimeiraMensagem(r, queued);

    expect(result).toMatchObject({ status: "ok", detail: "parcial:humano_respondeu" });
    expect(r.enviarBolha).toHaveBeenCalledTimes(1);
    expect(r.calls).toContain("send:0:Primeira");
    expect(r.calls).not.toContain("send:1:Segunda");
  });

  it("retoma da segunda bolha sem duplicar a primeira já confirmada", async () => {
    const processing = item();
    processing.status = "processing";
    processing.message_parts = ["Primeira", "Segunda", "Terceira"];
    processing.sent_part_count = 1;
    processing.outbound_message_id = "m-1";
    processing.outbound_message_ids = ["m-1"];
    const r = runtime([]);

    await processarItemFilaPrimeiraMensagem(r, processing);

    expect(r.enviarBolha).toHaveBeenCalledTimes(2);
    expect(r.calls).not.toContain("send:0:Primeira");
    expect(r.calls).toContain("send:1:Segunda");
    expect(r.calls).toContain("send:2:Terceira");
  });

  it("falha terminal na segunda bolha não reenvia a primeira", async () => {
    const processing = item();
    processing.status = "processing";
    processing.message_parts = ["Primeira", "Segunda", "Terceira"];
    processing.sent_part_count = 1;
    processing.outbound_message_id = "m-1";
    processing.outbound_message_ids = ["m-1"];
    const r = runtime([]);
    vi.mocked(r.enviarBolha).mockResolvedValueOnce({
      type: "send_whatsapp_message",
      status: "failed",
      error: "channel_send_failed",
      detail: { message_id: "m-2" },
    });

    const result = await processarItemFilaPrimeiraMensagem(r, processing);

    expect(result).toMatchObject({
      status: "ok",
      detail: "partial_send_failed:channel_send_failed",
    });
    expect(r.enviarBolha).toHaveBeenCalledTimes(1);
    expect(r.enviarBolha).toHaveBeenCalledWith(
      expect.objectContaining({ id: "fila-1" }),
      "Segunda",
      1,
    );
  });

  it("mantém item legado sem partes como uma única mensagem", async () => {
    const legacy = item();
    legacy.action_config = { fila: "primeira_mensagem", template: "Mensagem única" };
    const r = runtime([turno("ready"), turno("claimed")]);

    await processarItemFilaPrimeiraMensagem(r, legacy);

    expect(r.enviarBolha).toHaveBeenCalledTimes(1);
    expect(r.enviarBolha).toHaveBeenCalledWith(
      expect.objectContaining({ id: "fila-1" }),
      "Mensagem única",
      0,
    );
    expect(r.pausarEntreBolhas).not.toHaveBeenCalled();
  });

  it.each([
    [["nao_contatar"], "tag_nao_contatar"],
    [["sem_followup"], "tag_sem_followup"],
  ])("descarta a tag %s", (tags, expected) => {
    expect(motivoParaDescartarFila(snapshot({ tags: tags as string[] }), NOW)).toBe(expected);
  });

  it("descarta quando a última entrada passou de 23 horas", () => {
    expect(
      motivoParaDescartarFila(snapshot({ latestInboundAt: "2026-10-27T15:59:59.999Z" }), NOW),
    ).toBe("janela_24h_expirada");
  });

  it("mantém a data de entrada desconhecida como descarte seguro", () => {
    expect(motivoParaDescartarFila(snapshot({ latestInboundAt: null }), NOW)).toBe(
      "janela_24h_desconhecida",
    );
  });

  it("descarta quando a mensagem recebida pede para não incomodar", () => {
    expect(
      motivoParaDescartarFila(
        snapshot({ latestInboundBody: "Não quero mais receber mensagens" }),
        NOW,
      ),
    ).toBe("pedido_opt_out");
  });

  it.each([
    [{ humanRepliedAfterQueue: true }, "humano_respondeu"],
    [
      { conversation: { ...snapshot().conversation, assignedToUserId: "user-1" } },
      "conversa_atribuida",
    ],
    [
      {
        conversation: { ...snapshot().conversation, botSilencedUntil: "2026-10-29T15:00:00.000Z" },
      },
      "ia_pausada",
    ],
  ])("descarta quando um humano assumiu: %s", (override, expected) => {
    expect(motivoParaDescartarFila(snapshot(override as Partial<SnapshotGuardaFila>), NOW)).toBe(
      expected,
    );
  });
});

describe("limite da fila conforme a capacidade do canal", () => {
  const entradaHa = (horas: number, minutos = 0) =>
    new Date(NOW.getTime() - (horas * 60 + minutos) * 60_000).toISOString();

  it("mantém o canal oficial em 23 h: 22h59 envia e 23h01 descarta", () => {
    const politica = politicaEsperaFilaPorCanal(PROVIDER_COM_JANELA, 168);

    expect(
      motivoParaDescartarFila(snapshot({ latestInboundAt: entradaHa(22, 59) }), NOW, politica),
    ).toBeNull();
    expect(
      motivoParaDescartarFila(snapshot({ latestInboundAt: entradaHa(23, 1) }), NOW, politica),
    ).toBe("janela_24h_expirada");
  });

  it("envia depois de 40 h no canal sem janela oficial", () => {
    const politica = politicaEsperaFilaPorCanal(PROVIDER_SEM_JANELA, null);
    expect(
      motivoParaDescartarFila(snapshot({ latestInboundAt: entradaHa(40) }), NOW, politica),
    ).toBeNull();
  });

  it("descarta depois de 73 h no canal sem janela oficial com motivo próprio", () => {
    const politica = politicaEsperaFilaPorCanal(PROVIDER_SEM_JANELA, null);
    expect(
      motivoParaDescartarFila(snapshot({ latestInboundAt: entradaHa(73) }), NOW, politica),
    ).toBe("espera_maxima_excedida");
  });

  it("usa 72 h quando o knob é nulo", () => {
    expect(politicaEsperaFilaPorCanal(PROVIDER_SEM_JANELA, null)).toEqual({
      limiteMs: 72 * 60 * 60 * 1_000,
      motivoExcedido: "espera_maxima_excedida",
    });
  });

  it("respeita o limite configurado de 12 h", () => {
    const politica = politicaEsperaFilaPorCanal(PROVIDER_SEM_JANELA, 12);
    expect(
      motivoParaDescartarFila(snapshot({ latestInboundAt: entradaHa(12) }), NOW, politica),
    ).toBeNull();
    expect(
      motivoParaDescartarFila(snapshot({ latestInboundAt: entradaHa(12, 1) }), NOW, politica),
    ).toBe("espera_maxima_excedida");
  });
});

function adminDaPoliticaDeEspera(provider: string, maxWaitHours: number | null) {
  const filtros: Array<{ tabela: string; iguais: Array<[string, unknown]> }> = [];
  const admin = {
    from(tabela: string) {
      const iguais: Array<[string, unknown]> = [];
      filtros.push({ tabela, iguais });
      const query = {
        select: () => query,
        eq: (coluna: string, valor: unknown) => {
          iguais.push([coluna, valor]);
          return query;
        },
        maybeSingle: async () => ({
          data:
            tabela === "channel_sessions"
              ? { provider }
              : { first_message_queue_max_wait_hours: maxWaitHours },
          error: null,
        }),
      };
      return query;
    },
  };
  return { admin, filtros };
}

describe("leitura da política de espera do canal", () => {
  it("descobre o provider e o knob com filtro explícito de organização", async () => {
    const db = adminDaPoliticaDeEspera(PROVIDER_SEM_JANELA, 12);

    await expect(carregarPoliticaEsperaFila(db.admin as never, item())).resolves.toEqual({
      limiteMs: 12 * 60 * 60 * 1_000,
      motivoExcedido: "espera_maxima_excedida",
    });
    expect(db.filtros).toEqual([
      {
        tabela: "channel_sessions",
        iguais: [
          ["organization_id", "org-1"],
          ["id", "canal-1"],
        ],
      },
      {
        tabela: "channel_knobs",
        iguais: [
          ["organization_id", "org-1"],
          ["channel_session_id", "canal-1"],
        ],
      },
    ]);
  });
});

interface MensagemDoCanal {
  organization_id: string;
  channel_session_id: string;
  conversation_id: string;
  direction: "inbound" | "outbound";
  sent_via: string;
  status: string;
  type: string;
  sent_at: string;
}

function adminDaConversaEmAndamento(busyMinutes: number | null, messages: MensagemDoCanal[]) {
  const tabelasLidas: string[] = [];
  const admin = {
    from(table: string) {
      tabelasLidas.push(table);
      const equals = new Map<string, unknown>();
      const inclusions = new Map<string, unknown[]>();
      const notEquals = new Map<string, unknown>();
      const greaterThanOrEqual = new Map<string, unknown>();
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          equals.set(column, value);
          return query;
        },
        in: (column: string, values: unknown[]) => {
          inclusions.set(column, values);
          return query;
        },
        neq: (column: string, value: unknown) => {
          notEquals.set(column, value);
          return query;
        },
        gte: (column: string, value: unknown) => {
          greaterThanOrEqual.set(column, value);
          return query;
        },
        limit: () => query,
        maybeSingle: async () => {
          if (table === "channel_knobs") {
            return {
              data: { first_message_queue_busy_minutes: busyMinutes },
              error: null,
            };
          }
          const found = messages.find((message) => {
            for (const [column, value] of equals) {
              if (message[column as keyof MensagemDoCanal] !== value) return false;
            }
            for (const [column, values] of inclusions) {
              if (!values.includes(message[column as keyof MensagemDoCanal])) return false;
            }
            for (const [column, value] of notEquals) {
              if (message[column as keyof MensagemDoCanal] === value) return false;
            }
            for (const [column, value] of greaterThanOrEqual) {
              if (String(message[column as keyof MensagemDoCanal]) < String(value)) return false;
            }
            return true;
          });
          return { data: found ? { id: "mensagem-humana" } : null, error: null };
        },
      };
      return query;
    },
  };
  return { admin, tabelasLidas };
}

function mensagemDoCanal(overrides: Partial<MensagemDoCanal> = {}): MensagemDoCanal {
  return {
    organization_id: "org-1",
    channel_session_id: "canal-1",
    conversation_id: "outra-conversa",
    direction: "outbound",
    sent_via: "user",
    status: "sent",
    type: "text",
    sent_at: "2026-10-28T14:58:00.000Z",
    ...overrides,
  };
}

describe("conversa humana em andamento no canal", () => {
  it.each([null, 0])("mantém o comportamento desligado com parâmetro %s", async (minutes) => {
    const db = adminDaConversaEmAndamento(minutes, [mensagemDoCanal()]);

    await expect(haConversaHumanaEmAndamentoNoCanal(db.admin as never, item(), NOW)).resolves.toBe(
      false,
    );
    expect(db.tabelasLidas).toEqual(["channel_knobs"]);
  });

  it.each(["user", "external_device"])(
    "conta resposta recente da equipe em outra conversa via %s",
    async (sentVia) => {
      const db = adminDaConversaEmAndamento(3, [mensagemDoCanal({ sent_via: sentVia })]);

      await expect(
        haConversaHumanaEmAndamentoNoCanal(db.admin as never, item(), NOW),
      ).resolves.toBe(true);
    },
  );

  it.each(["automation", "ai", "crm", "system"])(
    "não conta mensagem automática com origem %s",
    async (sentVia) => {
      const db = adminDaConversaEmAndamento(3, [mensagemDoCanal({ sent_via: sentVia })]);

      await expect(
        haConversaHumanaEmAndamentoNoCanal(db.admin as never, item(), NOW),
      ).resolves.toBe(false);
    },
  );

  it("não conta modelo aprovado mesmo quando uma pessoa iniciou o envio", async () => {
    const db = adminDaConversaEmAndamento(3, [
      mensagemDoCanal({ sent_via: "user", type: "template" }),
    ]);

    await expect(haConversaHumanaEmAndamentoNoCanal(db.admin as never, item(), NOW)).resolves.toBe(
      false,
    );
  });

  it("não conta mensagem humana da própria conversa do lead", async () => {
    const db = adminDaConversaEmAndamento(3, [mensagemDoCanal({ conversation_id: "conversa-1" })]);

    await expect(haConversaHumanaEmAndamentoNoCanal(db.admin as never, item(), NOW)).resolves.toBe(
      false,
    );
  });

  it("não conta mensagem humana anterior à janela configurada", async () => {
    const db = adminDaConversaEmAndamento(3, [
      mensagemDoCanal({ sent_at: "2026-10-28T14:56:59.999Z" }),
    ]);

    await expect(haConversaHumanaEmAndamentoNoCanal(db.admin as never, item(), NOW)).resolves.toBe(
      false,
    );
  });
});
