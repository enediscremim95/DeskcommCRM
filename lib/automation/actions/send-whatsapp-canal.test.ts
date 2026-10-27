import { beforeEach, describe, expect, it, vi } from "vitest";

import { getAction } from "@/lib/automation/actions";
import type { ActionCtx } from "@/lib/automation/types";
import { logger } from "@/lib/logger";

const send = vi.hoisted(() => vi.fn(async () => ({ id: "message-1", status: "sent" })));
const boundary = vi.hoisted(() => vi.fn(async () => ({
  conversation_id: "33333333-3333-4333-8333-333333333333",
  organization_id: "11111111-1111-4111-8111-111111111111",
  contact_id: "22222222-2222-4222-8222-222222222222",
  service_revision: 1,
  demanda_id: null,
  demanda_revision: null,
})));

vi.mock("@/app/api/v1/messages/_handler", () => ({ sendMessageHandler: send }));
vi.mock("@/lib/atendimento/origem-automacao", () => ({ serviceForAutomation: boundary }));
vi.mock("@/lib/automation/guarda-do-contato", () => ({
  checarGuardasDeContato: () => ({
    ok: true,
    contact: { id: "22222222-2222-4222-8222-222222222222", phone_number: "+5541999999999" },
  }),
}));
vi.mock("@/lib/agenda/efeito", () => ({ assertAgendaEffectSupabase: vi.fn(async () => {}) }));
vi.mock("@/lib/agenda/protecao-followup", () => ({
  protecaoAgendaSupabase: vi.fn(async () => new Map([
    ["22222222-2222-4222-8222-222222222222", { motivo: "sem_agendamento", adiar: false }],
  ])),
}));
vi.mock("@/lib/automation/throttle", () => ({
  checkDailyLimit: vi.fn(async () => ({ allowed: true })),
  espacarEnvio: vi.fn(async () => {}),
}));
vi.mock("@/lib/automation/janela-do-canal", () => ({
  adiarAteAJanelaAbrir: vi.fn(async () => null),
  knobsDoCanal: vi.fn(async () => ({ timezone: "America/Sao_Paulo" })),
}));
vi.mock("@/lib/automation/desfecho-do-envio", () => ({
  reportarEnvio: vi.fn(async () => ({ type: "send_whatsapp_message", status: "success" })),
}));
vi.mock("@/lib/messaging/presenca", () => ({ sinalizarDigitando: vi.fn(async () => {}) }));
vi.mock("@/lib/messaging/resposta-humana", () => ({
  houveRespostaHumanaDepoisDoEvento: vi.fn(async () => false),
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import "@/lib/automation/actions/send-whatsapp";

const ORG = "11111111-1111-4111-8111-111111111111";
const ACTION_CHANNEL = "44444444-4444-4444-8444-444444444444";

function ctx(eventChannel?: string, sameChannelOnly = false): ActionCtx {
  return {
    admin: {} as ActionCtx["admin"],
    organizationId: ORG,
    ruleId: "55555555-5555-4555-8555-555555555555",
    ruleName: "Sauda\u00e7\u00e3o",
    requestId: "req-test",
    event: {
      id: "66666666-6666-4666-8666-666666666666",
      organization_id: ORG,
      event_type: "message.received",
      entity_kind: "message",
      entity_id: "77777777-7777-4777-8777-777777777777",
      payload: eventChannel ? { channel_session_id: eventChannel } : {},
      metadata: {},
      consumed_by: [],
      attempts: 0,
      created_at: "2026-10-27T12:00:00.000Z",
    },
    context: {},
    automationGuards: { sameChannelOnly },
  };
}

beforeEach(() => {
  send.mockClear();
  boundary.mockClear();
  vi.mocked(logger.warn).mockClear();
});

describe("send_whatsapp_message, canal do evento", () => {
  it("sem automation_guards, canal diferente mantém o envio anterior", async () => {
    const result = await getAction("send_whatsapp_message")!.execute(
      ctx("88888888-8888-4888-8888-888888888888"),
      { channel_session_id: ACTION_CHANNEL, template: "Ol\u00e1" },
    );

    expect(result.status).toBe("success");
    expect(send).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("com same_channel_only, canal igual envia pela sess\u00e3o configurada", async () => {
    const result = await getAction("send_whatsapp_message")!.execute(ctx(ACTION_CHANNEL, true), {
      channel_session_id: ACTION_CHANNEL,
      template: "Ol\u00e1",
    });

    expect(result.status).toBe("success");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("com same_channel_only, canal diferente pula sem resolver conversa nem enviar", async () => {
    const result = await getAction("send_whatsapp_message")!.execute(
      ctx("88888888-8888-4888-8888-888888888888", true),
      { channel_session_id: ACTION_CHANNEL, template: "Ol\u00e1" },
    );

    expect(result).toMatchObject({
      type: "send_whatsapp_message",
      status: "skipped",
      detail: {
        reason: "channel_mismatch",
        event_channel_session_id: "88888888-8888-4888-8888-888888888888",
        action_channel_session_id: ACTION_CHANNEL,
      },
    });
    expect(boundary).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("com same_channel_only e sem canal no evento, mant\u00e9m o envio e registra aviso", async () => {
    const result = await getAction("send_whatsapp_message")!.execute(ctx(undefined, true), {
      channel_session_id: ACTION_CHANNEL,
      template: "Ol\u00e1",
    });

    expect(result.status).toBe("success");
    expect(send).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("canal de origem"),
      expect.objectContaining({ organization_id: ORG }),
    );
  });
});
