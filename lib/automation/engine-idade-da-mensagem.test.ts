import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerAction } from "@/lib/automation/actions";
import {
  AUTOMATION_CONSUMER_KEY,
  runAutomationForEvent,
} from "@/lib/automation/engine";
import type { ActionCtx } from "@/lib/automation/types";
import type { EventRow } from "@/lib/event-log/dispatcher";
import { logger } from "@/lib/logger";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const ORG = "11111111-1111-4111-8111-111111111111";
const RULE = "22222222-2222-4222-8222-222222222222";
const EVENT = "33333333-3333-4333-8333-333333333333";
const MESSAGE = "44444444-4444-4444-8444-444444444444";
const CONTACT = "55555555-5555-4555-8555-555555555555";
const CHANNEL = "66666666-6666-4666-8666-666666666666";

const execute = vi.fn(async (_ctx: ActionCtx) => ({
  type: "fake_message_age_action",
  status: "success" as const,
}));
const pacedExecute = vi.fn(async () => ({
  type: "fake_message_age_paced_action",
  status: "success" as const,
}));

registerAction({ type: "fake_message_age_action", execute });
registerAction({
  type: "fake_message_age_paced_action",
  humanPacing: { textLength: async () => 20 },
  execute: pacedExecute,
});

interface Write {
  table: string;
  operation: "insert" | "update";
  payload: Record<string, unknown>;
}

interface AdminOptions {
  triggerEvent?: string;
  settings?: unknown;
  actionType?: "fake_message_age_action" | "fake_message_age_paced_action";
}

function adminDouble(messageSentAt: string | null, options: AdminOptions = {}) {
  const writes: Write[] = [];
  let organizationReads = 0;
  const triggerEvent = options.triggerEvent ?? "message.received";
  const rules = [
    {
      id: RULE,
      name: "Resposta de entrada",
      conditions: [],
      actions: [{ type: options.actionType ?? "fake_message_age_action", config: {} }],
      trigger_event: triggerEvent,
    },
  ];

  function query(table: string) {
    let operation: "select" | "insert" | "update" = "select";
    let selected = "";
    const self: Record<string, unknown> = {
      select: (columns?: string) => {
        selected = columns ?? "";
        return self;
      },
      eq: () => self,
      order: () => self,
      insert: (payload: Record<string, unknown>) => {
        operation = "insert";
        writes.push({ table, operation, payload });
        return self;
      },
      update: (payload: Record<string, unknown>) => {
        operation = "update";
        writes.push({ table, operation, payload });
        return self;
      },
      maybeSingle: async () => {
        if (table === "organizations") {
          organizationReads += 1;
          return { data: { settings: options.settings ?? {} }, error: null };
        }
        if (table === "messages") {
          return {
            data: {
              id: MESSAGE,
              contact_id: CONTACT,
              conversation_id: "77777777-7777-4777-8777-777777777777",
              channel_session_id: CHANNEL,
              sent_at: messageSentAt,
            },
            error: null,
          };
        }
        if (table === "contacts") {
          return {
            data: { id: CONTACT, phone_number: "+5541999999999", is_blocked: false },
            error: null,
          };
        }
        if (table === "automation_rule_runs" && operation === "insert") {
          return { data: { id: "88888888-8888-4888-8888-888888888888" }, error: null };
        }
        if (table === "automation_rules" && selected === "run_count") {
          return { data: { run_count: 0 }, error: null };
        }
        return { data: null, error: null };
      },
      then: (resolve: (value: unknown) => void) => {
        if (table === "automation_rules" && operation === "select" && selected !== "run_count") {
          resolve({ data: rules, error: null });
          return;
        }
        resolve({ data: null, error: null });
      },
    };
    return self;
  }

  return {
    admin: { from: (table: string) => query(table) },
    writes,
    organizationReads: () => organizationReads,
  };
}

function event(eventType = "message.received"): EventRow {
  return {
    id: EVENT,
    organization_id: ORG,
    event_type: eventType,
    entity_kind: eventType === "message.received" ? "message" : "crm_lead",
    entity_id: eventType === "message.received" ? MESSAGE : null,
    payload:
      eventType === "message.received"
        ? { contact_id: CONTACT, channel_session_id: CHANNEL }
        : {},
    metadata: {},
    consumed_by: [],
    attempts: 0,
    created_at: "2026-10-27T12:00:00.000Z",
  };
}

beforeEach(() => {
  execute.mockClear();
  pacedExecute.mockClear();
  vi.mocked(logger.warn).mockClear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-27T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("automation engine, idade da mensagem recebida", () => {
  it("sem automation_guards, mensagem antiga mantém o comportamento anterior", async () => {
    const db = adminDouble("2026-10-27T08:00:00.000Z");

    expect(await runAutomationForEvent(db.admin as never, event())).toEqual({
      consumer_key: AUTOMATION_CONSUMER_KEY,
      status: "ok",
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(db.organizationReads()).toBe(1);
    expect(execute.mock.calls[0]![0].automationGuards).toEqual({ sameChannelOnly: false });
  });

  it("com max_message_age_minutes, mensagem recente passa", async () => {
    const db = adminDouble("2026-10-27T11:45:00.000Z", {
      settings: { automation_guards: { max_message_age_minutes: 30 } },
    });

    expect((await runAutomationForEvent(db.admin as never, event())).status).toBe("ok");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("com max_message_age_minutes, mensagem antiga é pulada e registrada", async () => {
    const db = adminDouble("2026-10-27T11:29:59.000Z", {
      settings: { automation_guards: { max_message_age_minutes: 30 } },
    });

    expect(await runAutomationForEvent(db.admin as never, event())).toEqual({
      consumer_key: AUTOMATION_CONSUMER_KEY,
      status: "skipped",
      detail: "message_too_old",
    });
    expect(execute).not.toHaveBeenCalled();
    expect(db.writes).toContainEqual(
      expect.objectContaining({
        table: "automation_rule_runs",
        operation: "insert",
        payload: expect.objectContaining({
          actions_result: [
            expect.objectContaining({
              type: "fake_message_age_action",
              status: "skipped",
              detail: expect.objectContaining({
                reason: "message_too_old",
                message_sent_at: "2026-10-27T11:29:59.000Z",
                max_age_minutes: 30,
              }),
            }),
          ],
        }),
      }),
    );
  });

  it.each([0, -1, "30", null])(
    "valor inválido %j desliga a trava de idade",
    async (invalidValue) => {
      const db = adminDouble("2026-10-27T08:00:00.000Z", {
        settings: { automation_guards: { max_message_age_minutes: invalidValue } },
      });

      expect((await runAutomationForEvent(db.admin as never, event())).status).toBe("ok");
      expect(execute).toHaveBeenCalledTimes(1);
    },
  );

  it("sem timestamp conhecido mantém o comportamento e registra aviso quando a trava está ligada", async () => {
    const db = adminDouble(null, {
      settings: { automation_guards: { max_message_age_minutes: 30 } },
    });

    expect((await runAutomationForEvent(db.admin as never, event())).status).toBe("ok");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("horário da mensagem"),
      expect.objectContaining({ organization_id: ORG, event_id: EVENT }),
    );
  });

  it("retomada após adiamento não é descartada quando a mensagem envelhece", async () => {
    const db = adminDouble("2026-10-27T11:45:00.000Z", {
      settings: { automation_guards: { max_message_age_minutes: 30 } },
      actionType: "fake_message_age_paced_action",
    });
    const row = event();

    expect((await runAutomationForEvent(db.admin as never, row)).status).toBe("retry");
    vi.setSystemTime(new Date("2026-10-27T14:00:00.000Z"));
    expect((await runAutomationForEvent(db.admin as never, row)).status).toBe("retry");
    expect(await runAutomationForEvent(db.admin as never, row)).toMatchObject({ status: "ok" });
    expect(pacedExecute).toHaveBeenCalledTimes(1);
  });

  it("não aplica a trava a outros gatilhos", async () => {
    const db = adminDouble("2020-01-01T00:00:00.000Z", {
      triggerEvent: "lead.created",
      settings: { automation_guards: { max_message_age_minutes: 1 } },
    });

    expect((await runAutomationForEvent(db.admin as never, event("lead.created"))).status).toBe("ok");
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
