import { beforeEach, describe, expect, it, vi } from "vitest";

import { registerAction } from "@/lib/automation/actions";
import { AUTOMATION_CONSUMER_KEY, runAutomationForEvent } from "@/lib/automation/engine";
import { RITMO_HUMANO_METADATA_KEY } from "@/lib/automation/ritmo-humano";
import type { EventRow } from "@/lib/event-log/dispatcher";

const order: string[] = [];
const execute = vi.fn(async (_ctx: unknown, config: Record<string, unknown>) => {
  order.push(`message:${String(config.id ?? "sem-id")}`);
  return { type: "fake_human_pacing", status: "success" as const };
});
const executeNormal = vi.fn(async (_ctx: unknown, config: Record<string, unknown>) => {
  order.push(`normal:${String(config.id ?? "sem-id")}`);
  return { type: "fake_normal", status: "success" as const };
});

registerAction({
  type: "fake_human_pacing",
  humanPacing: {
    async textLength() {
      return 58;
    },
  },
  execute,
});
registerAction({ type: "fake_normal", execute: executeNormal });

interface Write {
  table: string;
  operation: "insert" | "update";
  payload: Record<string, unknown>;
}

function adminDouble(actions = [{ type: "fake_human_pacing", config: {} }]) {
  const writes: Write[] = [];
  const rules = [
    {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Conversa humana",
      conditions: [],
      actions,
    },
  ];

  function query(table: string) {
    let operation: "select" | "insert" | "update" = "select";
    const self: Record<string, unknown> = {
      select: () => self,
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
      maybeSingle: async () =>
        table === "automation_rule_runs" && operation === "insert"
          ? { data: { id: "22222222-2222-4222-8222-222222222222" }, error: null }
          : { data: null, error: null },
      then: (resolve: (value: unknown) => void) => {
        if (table === "automation_rules" && operation === "select") {
          resolve({ data: rules, error: null });
          return;
        }
        resolve({ data: null, error: null });
      },
    };
    return self;
  }

  return { admin: { from: (table: string) => query(table) }, writes };
}

function event(): EventRow {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    organization_id: "44444444-4444-4444-8444-444444444444",
    event_type: "test.human_pacing",
    entity_kind: "test",
    entity_id: null,
    payload: {},
    metadata: {},
    consumed_by: [],
    attempts: 0,
  };
}

beforeEach(() => {
  execute.mockClear();
  executeNormal.mockClear();
  order.length = 0;
});

describe("automation engine — espera humana sem bloquear o processo", () => {
  it("persiste o cursor e devolve retry sem criar timer nem executar o envio", async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const { admin, writes } = adminDouble();
    const startedAt = Date.now();

    const result = await runAutomationForEvent(admin as never, event());

    expect(result.consumer_key).toBe(AUTOMATION_CONSUMER_KEY);
    expect(result.status).toBe("retry");
    expect(Date.parse(result.retry_at!) - startedAt).toBeGreaterThanOrEqual(40_000);
    expect(Date.parse(result.retry_at!) - startedAt).toBeLessThan(100_100);
    expect(execute).not.toHaveBeenCalled();
    expect(setTimeoutSpy).not.toHaveBeenCalled();

    const stateWrite = writes.find((write) => write.table === "event_log" && write.operation === "update");
    expect(stateWrite?.payload.metadata).toMatchObject({
      [RITMO_HUMANO_METADATA_KEY]: {
        version: 1,
        current: {
          action_index: 0,
          action_type: "fake_human_pacing",
          phase: "iniciar_digitacao",
          text_length: 58,
        },
      },
    });
    expect(writes).toContainEqual(
      expect.objectContaining({
        table: "automation_rule_runs",
        operation: "insert",
        payload: expect.objectContaining({ status: "adiado" }),
      }),
    );

    setTimeoutSpy.mockRestore();
  });

  it("retoma o cursor sem repetir ações e mantém ações não textuais na sequência", async () => {
    const { admin } = adminDouble([
      { type: "fake_human_pacing", config: { id: "m1" } },
      { type: "fake_normal", config: { id: "tag" } },
      { type: "fake_human_pacing", config: { id: "m2" } },
    ]);
    const row = event();

    expect((await runAutomationForEvent(admin as never, row)).status).toBe("retry"); // 40–100s
    expect((await runAutomationForEvent(admin as never, row)).status).toBe("retry"); // digitando m1
    expect((await runAutomationForEvent(admin as never, row)).status).toBe("retry"); // envia m1, tag, pausa
    expect(order).toEqual(["message:m1", "normal:tag"]);

    expect((await runAutomationForEvent(admin as never, row)).status).toBe("retry"); // digitando m2
    expect((await runAutomationForEvent(admin as never, row)).status).toBe("ok"); // envia m2

    expect(order).toEqual(["message:m1", "normal:tag", "message:m2"]);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls.every(([ctx]) => (ctx as { humanPacingManaged?: boolean }).humanPacingManaged)).toBe(true);
    expect(row.metadata).not.toHaveProperty(RITMO_HUMANO_METADATA_KEY);
  });
});
