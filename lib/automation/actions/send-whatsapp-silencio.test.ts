import { beforeEach, describe, expect, it, vi } from "vitest";

import { getAction } from "@/lib/automation/actions";
import type { ActionCtx } from "@/lib/automation/types";

const check = vi.hoisted(() => vi.fn(async () => false));
const boundary = vi.hoisted(() => ({
  conversation_id: "33333333-3333-4333-8333-333333333333",
  organization_id: "11111111-1111-4111-8111-111111111111",
  contact_id: "22222222-2222-4222-8222-222222222222",
  service_revision: 1,
  demanda_id: null,
  demanda_revision: null,
}));

vi.mock("@/lib/messaging/resposta-humana", () => ({
  houveRespostaHumanaDepoisDoEvento: check,
}));
vi.mock("@/lib/automation/guarda-do-contato", () => ({
  checarGuardasDeContato: () => ({
    ok: true,
    contact: { id: boundary.contact_id, phone_number: "+5541999999999" },
  }),
}));
vi.mock("@/lib/atendimento/origem-automacao", () => ({
  serviceForAutomation: async () => boundary,
}));

import "@/lib/automation/actions/send-whatsapp";

const EVENT_CREATED_AT = "2026-09-29T12:00:00.000Z";

function ctx(): ActionCtx {
  return {
    admin: {} as ActionCtx["admin"],
    organizationId: boundary.organization_id,
    ruleId: "44444444-4444-4444-8444-444444444444",
    ruleName: "Saudação",
    requestId: "req-test",
    event: {
      id: "55555555-5555-4555-8555-555555555555",
      organization_id: boundary.organization_id,
      event_type: "lead.created",
      entity_kind: "crm_lead",
      entity_id: null,
      payload: {},
      metadata: {},
      consumed_by: [],
      attempts: 0,
      created_at: EVENT_CREATED_AT,
    },
    context: {},
  };
}

beforeEach(() => check.mockReset().mockResolvedValue(false));

describe("send_whatsapp_message, veto por resposta humana", () => {
  it("liga o veto real ao evento e encerra a regra quando o helper confirma", async () => {
    check.mockResolvedValue(true);
    const action = getAction("send_whatsapp_message");

    const result = await action?.interruptRule?.(ctx(), {
      channel_session_id: "66666666-6666-4666-8666-666666666666",
      template: "Olá",
    });

    expect(check).toHaveBeenCalledWith(expect.anything(), {
      organizationId: boundary.organization_id,
      conversationId: boundary.conversation_id,
      eventCreatedAt: EVENT_CREATED_AT,
    });
    expect(result).toMatchObject({
      type: "send_whatsapp_message",
      status: "skipped",
      detail: { reason: "human_replied_after_trigger" },
    });
  });

  it("falha fechado quando o evento não traz created_at", async () => {
    const semData = ctx();
    delete semData.event.created_at;
    const result = await getAction("send_whatsapp_message")?.interruptRule?.(semData, {
      channel_session_id: "66666666-6666-4666-8666-666666666666",
    });

    expect(result).toMatchObject({
      status: "failed",
      error: "missing_event_created_at",
    });
    expect(check).not.toHaveBeenCalled();
  });
});
