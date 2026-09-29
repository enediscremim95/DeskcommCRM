import { beforeEach, describe, expect, it, vi } from "vitest";

import { registerAction } from "@/lib/automation/actions";
import { runAutomationForEvent } from "@/lib/automation/engine";
import { houveRespostaHumanaDepoisDoEvento } from "@/lib/messaging/resposta-humana";
import type { EventRow } from "@/lib/event-log/dispatcher";

const ORG = "11111111-1111-4111-8111-111111111111";
const RULE = "22222222-2222-4222-8222-222222222222";
const EVENT = "33333333-3333-4333-8333-333333333333";
const CONVERSATION = "44444444-4444-4444-8444-444444444444";
const EVENT_CREATED_AT = "2026-09-29T12:00:00.000Z";

const order: string[] = [];
const send = vi.fn(async () => {
  order.push("send");
  return { type: "fake_send_guarded", status: "success" as const };
});
const tag = vi.fn(async () => {
  order.push("tag");
  return { type: "fake_tag_after_send", status: "success" as const };
});

registerAction({
  type: "fake_send_guarded",
  interruptRule: async (ctx) => {
    if (!ctx.event.created_at) return null;
    const respondeu = await houveRespostaHumanaDepoisDoEvento(ctx.admin, {
      organizationId: ctx.organizationId,
      conversationId: CONVERSATION,
      eventCreatedAt: ctx.event.created_at,
    });
    return respondeu
      ? {
          type: "fake_send_guarded",
          status: "skipped",
          detail: { reason: "human_replied_after_trigger" },
        }
      : null;
  },
  humanPacing: { textLength: async () => 20 },
  execute: send,
});
registerAction({ type: "fake_tag_after_send", execute: tag });

interface HumanMessage {
  direction: "inbound" | "outbound";
  sent_via: string;
  created_at: string;
}

interface Write {
  table: string;
  operation: "insert" | "update";
  payload: Record<string, unknown>;
}

function adminDouble(initialMessages: HumanMessage[] = []) {
  const messages = [...initialMessages];
  const writes: Write[] = [];
  const rules = [
    {
      id: RULE,
      name: "Saudação e catálogo",
      conditions: [],
      actions: [
        { type: "fake_send_guarded", config: {} },
        { type: "fake_tag_after_send", config: {} },
      ],
    },
  ];

  function query(table: string) {
    let operation: "select" | "insert" | "update" = "select";
    let selected = "";
    const equals = new Map<string, unknown>();
    const inclusions = new Map<string, unknown[]>();
    const greaterThan = new Map<string, unknown>();
    const self: Record<string, unknown> = {
      select: (columns?: string) => {
        selected = columns ?? "";
        return self;
      },
      eq: (column: string, value: unknown) => {
        equals.set(column, value);
        return self;
      },
      in: (column: string, values: unknown[]) => {
        inclusions.set(column, values);
        return self;
      },
      gt: (column: string, value: unknown) => {
        greaterThan.set(column, value);
        return self;
      },
      limit: () => self,
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
        if (table === "messages") {
          const found = messages.find((message) => {
            if (equals.get("direction") !== message.direction) return false;
            const origins = inclusions.get("sent_via") ?? [];
            if (!origins.includes(message.sent_via)) return false;
            const threshold = String(greaterThan.get("created_at") ?? "");
            return message.created_at > threshold;
          });
          return { data: found ? { id: "human-message" } : null, error: null };
        }
        if (table === "automation_rule_runs" && operation === "insert") {
          return { data: { id: "55555555-5555-4555-8555-555555555555" }, error: null };
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
    messages,
    writes,
  };
}

function event(): EventRow {
  return {
    id: EVENT,
    organization_id: ORG,
    event_type: "test.silencio_pos_humano",
    entity_kind: "test",
    entity_id: null,
    payload: {},
    metadata: {},
    consumed_by: [],
    attempts: 0,
    created_at: EVENT_CREATED_AT,
  };
}

async function runUntilDone(admin: unknown, row: EventRow) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = await runAutomationForEvent(admin as never, row);
    if (result.status !== "retry") return result;
  }
  throw new Error("a automação não concluiu em cinco retomadas");
}

beforeEach(() => {
  order.length = 0;
  send.mockClear();
  tag.mockClear();
});

describe("automation_rules, silêncio depois de resposta humana", () => {
  it("resposta humana anterior ao evento não cala a regra", async () => {
    const db = adminDouble([
      { direction: "outbound", sent_via: "user", created_at: "2026-09-29T11:59:59.000Z" },
    ]);

    expect((await runUntilDone(db.admin, event())).status).toBe("ok");
    expect(order).toEqual(["send", "tag"]);
  });

  it("resposta humana posterior ao evento, durante o ritmo, encerra a regra inteira", async () => {
    const db = adminDouble();
    const row = event();

    expect((await runAutomationForEvent(db.admin as never, row)).status).toBe("retry");
    db.messages.push({
      direction: "outbound",
      sent_via: "external_device",
      created_at: "2026-09-29T12:00:01.000Z",
    });

    expect((await runAutomationForEvent(db.admin as never, row)).status).toBe("ok");
    expect(send).not.toHaveBeenCalled();
    expect(tag).not.toHaveBeenCalled();
    expect(db.writes).toContainEqual(
      expect.objectContaining({
        table: "automation_rule_runs",
        operation: "update",
        payload: expect.objectContaining({
          actions_result: expect.arrayContaining([
            expect.objectContaining({
              status: "skipped",
              detail: expect.objectContaining({ reason: "human_replied_after_trigger" }),
            }),
          ]),
        }),
      }),
    );
  });

  it("sem resposta humana, a regra segue normal", async () => {
    const db = adminDouble();

    expect((await runUntilDone(db.admin, event())).status).toBe("ok");
    expect(order).toEqual(["send", "tag"]);
  });

  it("mensagem automática posterior não conta como humano", async () => {
    const db = adminDouble([
      { direction: "outbound", sent_via: "ai", created_at: "2026-09-29T12:00:01.000Z" },
    ]);

    expect((await runUntilDone(db.admin, event())).status).toBe("ok");
    expect(order).toEqual(["send", "tag"]);
  });
});
