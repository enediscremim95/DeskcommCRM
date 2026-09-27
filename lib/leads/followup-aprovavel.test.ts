import { describe, expect, it } from "vitest";

import {
  deveSugerirNovamente,
  estadoDaAprovacao,
  lerRegraDeFollowupAprovavel,
} from "@/lib/leads/followup-aprovavel";

const RULE_ID = "11111111-1111-4111-8111-111111111111";
const STAGE_ID = "22222222-2222-4222-8222-222222222222";
const CHANNEL_ID = "33333333-3333-4333-8333-333333333333";

describe("follow-up aprovável", () => {
  it("aprovar usa uma regra ativa de mensagem fixa e relata a janela fechada sem fingir envio", () => {
    const rule = lerRegraDeFollowupAprovavel({
      id: RULE_ID,
      name: "Retomada comercial",
      trigger_event: "lead.stage_changed",
      is_active: true,
      conditions: [{ field: "event.to_stage_id", op: "eq", value: STAGE_ID }],
      actions: [{
        type: "send_whatsapp_message",
        config: { channel_session_id: CHANNEL_ID, template: "Oi, ainda posso ajudar?" },
      }],
    });

    expect(rule).toMatchObject({
      targetStageId: STAGE_ID,
      channelSessionId: CHANNEL_ID,
      message: "Oi, ainda posso ajudar?",
    });
    expect(estadoDaAprovacao("2026-09-27T10:00:00.000Z")).toEqual({
      delivery_status: "queued_window",
      scheduled_for: "2026-09-27T10:00:00.000Z",
    });
  });

  it("aprovar com janela aberta diz processamento, nunca mensagem enviada", () => {
    expect(estadoDaAprovacao(null)).toEqual({
      delivery_status: "processing",
      scheduled_for: null,
    });
  });

  it("não aprovar impede a mesma sugestão de voltar antes do prazo longo", () => {
    expect(deveSugerirNovamente(
      {
        stageId: STAGE_ID,
        lastInboundAt: "2026-09-20T10:00:00.000Z",
        resuggestAfterAt: "2026-10-10T10:00:00.000Z",
      },
      { stageId: STAGE_ID, lastInboundAt: "2026-09-20T10:00:00.000Z" },
      new Date("2026-09-27T10:00:00.000Z"),
    )).toBe(false);
  });

  it("reaparece quando o lead responde", () => {
    expect(deveSugerirNovamente(
      {
        stageId: STAGE_ID,
        lastInboundAt: "2026-09-20T10:00:00.000Z",
        resuggestAfterAt: "2026-10-10T10:00:00.000Z",
      },
      { stageId: STAGE_ID, lastInboundAt: "2026-09-27T09:00:00.000Z" },
      new Date("2026-09-27T10:00:00.000Z"),
    )).toBe(true);
  });

  it("reaparece quando muda de etapa", () => {
    expect(deveSugerirNovamente(
      {
        stageId: STAGE_ID,
        lastInboundAt: null,
        resuggestAfterAt: "2026-10-10T10:00:00.000Z",
      },
      { stageId: "44444444-4444-4444-8444-444444444444", lastInboundAt: null },
      new Date("2026-09-27T10:00:00.000Z"),
    )).toBe(true);
  });

  it("reaparece sem fato novo somente depois do prazo longo configurado", () => {
    const anterior = {
      stageId: STAGE_ID,
      lastInboundAt: null,
      resuggestAfterAt: "2026-10-10T10:00:00.000Z",
    };
    const atual = { stageId: STAGE_ID, lastInboundAt: null };

    expect(deveSugerirNovamente(anterior, atual, new Date("2026-10-10T09:59:59.000Z"))).toBe(false);
    expect(deveSugerirNovamente(anterior, atual, new Date("2026-10-10T10:00:00.000Z"))).toBe(true);
  });
});
