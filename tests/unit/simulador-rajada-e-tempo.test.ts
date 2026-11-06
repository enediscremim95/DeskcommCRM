import type pg from "pg";
import { describe, expect, it, vi } from "vitest";

import {
  newPreviewResult,
  previewGateContext,
  scenarioContext,
  type TurnPreview,
} from "@/lib/agent-engine/agent/preview";
import { evaluateBeforeSend } from "@/lib/agent-engine/guardrails/before-send";
import type { Logger } from "@/lib/agent-engine/obs/logger";
import { renderAgora } from "@/lib/tempo/agora";
import {
  construirRajada,
  parseDepoisDe,
  parseMensagensCli,
  relogioInicialDoTurno,
} from "@/scripts/simular-turno-opcoes";

describe("simulador de turno, parser da rajada", () => {
  it("mantém --msg como uma rajada de uma mensagem", () => {
    expect(parseMensagensCli({ msg: "oi" })).toEqual(["oi"]);
  });

  it("separa --msgs por |||, preserva a ordem e remove só as bordas", () => {
    expect(
      parseMensagensCli({
        msgs: " oi ||| tudo bem? ||| quero  30 lembrancinhas ",
      }),
    ).toEqual(["oi", "tudo bem?", "quero  30 lembrancinhas"]);
  });

  it("recusa duas opções concorrentes e item vazio no meio da rajada", () => {
    expect(() => parseMensagensCli({ msg: "oi", msgs: "olá|||tudo bem?" })).toThrow(
      /apenas uma/i,
    );
    expect(() => parseMensagensCli({ msgs: "oi||||||quero ajuda" })).toThrow(
      /mensagem vazia/i,
    );
  });
});

describe("simulador de turno, relógio", () => {
  it.each([
    ["3d", 3 * 24 * 60 * 60 * 1000],
    ["5h", 5 * 60 * 60 * 1000],
    ["40m", 40 * 60 * 1000],
  ])("interpreta --depois-de %s", (valor, esperado) => {
    expect(parseDepoisDe(valor)).toBe(esperado);
  });

  it.each(["", "0m", "3dias", "-5h", "1.5d", "40s"])(
    "recusa intervalo inválido: %s",
    (valor) => {
      expect(() => parseDepoisDe(valor)).toThrow(/3d\|5h\|40m/i);
    },
  );

  it("avança a partir da última mensagem do histórico", () => {
    const inicio = relogioInicialDoTurno(
      [{ sent_at: "2026-11-01T12:00:00.000Z" }],
      parseDepoisDe("3d"),
      new Date("2030-01-01T00:00:00.000Z"),
    );
    expect(inicio.toISOString()).toBe("2026-11-04T12:00:00.000Z");
  });

  it("não faz a linha do tempo regredir depois de um avanço anterior", () => {
    const inicio = relogioInicialDoTurno(
      [{ sent_at: "2030-01-01T00:00:00.000Z" }],
      undefined,
      new Date("2026-11-04T12:00:00.000Z"),
    );
    expect(inicio.toISOString()).toBe("2030-01-01T00:00:01.000Z");
  });

  it("registra todas as mensagens em ordem e fixa o relógio na última", () => {
    const rajada = construirRajada(
      ["oi", "quero lembrancinha", "umas 30"],
      new Date("2026-11-04T12:00:00.000Z"),
    );

    expect(rajada.mensagens).toEqual([
      { direction: "inbound", body: "oi", sent_at: "2026-11-04T12:00:00.000Z" },
      {
        direction: "inbound",
        body: "quero lembrancinha",
        sent_at: "2026-11-04T12:00:01.000Z",
      },
      {
        direction: "inbound",
        body: "umas 30",
        sent_at: "2026-11-04T12:00:02.000Z",
      },
    ]);
    expect(rajada.relogioDoTurno.toISOString()).toBe("2026-11-04T12:00:02.000Z");
  });

  it("entrega o relógio simulado ao bloco Agora e à janela de 24 horas", async () => {
    const agora = new Date("2026-11-04T12:00:02.000Z");
    const ultimoInbound = "2026-11-01T12:00:00.000Z";
    const result = newPreviewResult();
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const preview = {
      kind: "sandbox",
      organizationId: "org-teste",
      runId: "run-teste",
      agent: { toolIds: [], handoffKeywords: [], casesEnabled: false } as unknown as TurnPreview["agent"],
      context: scenarioContext([
        { direction: "inbound", body: "voltei", sent_at: ultimoInbound },
      ]),
      contactId: null,
      channelId: null,
      result,
    } satisfies TurnPreview;

    const gate = await previewGateContext(
      { query } as unknown as pg.Pool,
      preview,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as Logger,
      agora,
    );

    expect(gate.now).toEqual(agora);
    expect(gate.messagingWindow?.lastInboundAt?.toISOString()).toBe(ultimoInbound);
    expect(renderAgora(gate.now, "America/Sao_Paulo")).toContain(
      "instante_absoluto: 2026-11-04T12:00:02.000Z",
    );
    expect(
      evaluateBeforeSend({
        ...gate,
        // O cenário não lê um canal real. Força aqui o canal oficial para
        // provar a física de 24 h com o mesmo `now` entregue ao preview.
        provider: "meta_cloud",
        body: "Que bom que você voltou.",
      }).veto?.code,
    ).toBe("messaging_window_closed");
    expect(result.restrictions).toContain("contact_state_is_scenario");
  });

  it("usa a hora simulada para o horário de envio do sandbox", async () => {
    const agora = new Date("2026-11-04T06:00:00.000Z"); // 03:00 em São Paulo
    const result = newPreviewResult();
    const preview = {
      kind: "sandbox",
      organizationId: "org-teste",
      runId: "run-teste",
      agent: { toolIds: [], handoffKeywords: [], casesEnabled: false } as unknown as TurnPreview["agent"],
      context: scenarioContext([
        { direction: "inbound", body: "oi", sent_at: agora.toISOString() },
      ]),
      contactId: null,
      channelId: null,
      result,
    } satisfies TurnPreview;

    const gate = await previewGateContext(
      { query: vi.fn().mockResolvedValue({ rows: [] }) } as unknown as pg.Pool,
      preview,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as Logger,
      agora,
    );

    expect(evaluateBeforeSend({ ...gate, body: "Olá!" }).veto?.code).toBe("outside_window");
  });
});
