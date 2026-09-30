import { beforeEach, describe, expect, it, vi } from "vitest";

import { registerAction } from "@/lib/automation/actions";
import { runAutomationForEvent } from "@/lib/automation/engine";
import type { EventRow } from "@/lib/event-log/dispatcher";

const ORG = "11111111-1111-4111-8111-111111111111";
const CONTACT = "22222222-2222-4222-8222-222222222222";
const EVENT = "33333333-3333-4333-8333-333333333333";
const RULE_LEMBRANCINHAS = "44444444-4444-4444-8444-444444444444";
const RULE_PRESENTE = "55555555-5555-4555-8555-555555555555";

const tags: string[] = [];
const adicionarTag = vi.fn(async () => {
  tags.push("sub_aguarda_genero_lembrancinhas");
  return { type: "fake_add_tag_retomada", status: "success" as const };
});
const enviar = vi.fn(async () => ({ type: "fake_send_retomada", status: "success" as const }));

registerAction({ type: "fake_add_tag_retomada", execute: adicionarTag });
registerAction({
  type: "fake_send_retomada",
  humanPacing: { textLength: async () => 80 },
  execute: enviar,
});

const regras = [
  {
    id: RULE_LEMBRANCINHAS,
    name: "Lembrancinhas - abertura",
    conditions: [
      {
        field: "event.body_preview",
        op: "contains",
        value: "lembrancinhas personalizadas",
      },
      {
        field: "contact.tags",
        op: "not_contains",
        value: "sub_aguarda_categoria",
      },
      {
        field: "contact.tags",
        op: "not_contains",
        value: "sub_aguarda_genero_padrinhos",
      },
      {
        field: "contact.tags",
        op: "not_contains",
        value: "sub_aguarda_genero_lembrancinhas",
      },
    ],
    actions: [{ type: "fake_add_tag_retomada" }, { type: "fake_send_retomada" }],
  },
  {
    id: RULE_PRESENTE,
    name: "Presente especial - menu",
    conditions: [
      {
        field: "event.body_preview",
        op: "contains",
        value: "presente especial",
      },
    ],
    actions: [{ type: "fake_send_retomada" }],
  },
];

interface Write {
  table: string;
  operation: "insert" | "update";
  payload: Record<string, unknown>;
}

function adminDouble() {
  const writes: Write[] = [];

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
        if (table === "contacts") {
          return { data: { id: CONTACT, tags: [...tags] }, error: null };
        }
        if (table === "automation_rule_runs" && operation === "insert") {
          return { data: { id: "66666666-6666-4666-8666-666666666666" }, error: null };
        }
        if (table === "automation_rules" && selected === "run_count") {
          return { data: { run_count: 0 }, error: null };
        }
        return { data: null, error: null };
      },
      then: (resolve: (value: unknown) => void) => {
        if (table === "automation_rules" && operation === "select" && selected !== "run_count") {
          resolve({ data: regras, error: null });
          return;
        }
        resolve({ data: null, error: null });
      },
    };
    return self;
  }

  return { admin: { from: (table: string) => query(table) }, writes };
}

function evento(bodyPreview: string): EventRow {
  return {
    id: EVENT,
    organization_id: ORG,
    event_type: "message.received",
    entity_kind: "message",
    entity_id: "77777777-7777-4777-8777-777777777777",
    payload: { contact_id: CONTACT, body_preview: bodyPreview },
    metadata: {},
    consumed_by: [],
    attempts: 0,
  };
}

async function rodarAteConcluir(admin: unknown, row: EventRow) {
  for (let tentativa = 0; tentativa < 5; tentativa += 1) {
    const resultado = await runAutomationForEvent(admin as never, row);
    if (resultado.status !== "retry") return resultado;
  }
  throw new Error("a automação não concluiu em cinco retomadas");
}

beforeEach(() => {
  tags.length = 0;
  adicionarTag.mockClear();
  enviar.mockClear();
});

describe("automation_rules, condições na retomada", () => {
  it("conclui a regra real mesmo quando uma ação anterior adiciona a tag que bloqueava a entrada", async () => {
    const db = adminDouble();
    const row = evento(
      "Ola! Me chamo Amanda e quero encomendar lembrancinhas personalizadas",
    );

    expect((await rodarAteConcluir(db.admin, row)).status).toBe("ok");
    expect(adicionarTag).toHaveBeenCalledTimes(1);
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(db.writes).toContainEqual(
      expect.objectContaining({
        table: "automation_rules",
        operation: "update",
        payload: expect.objectContaining({ run_count: 1 }),
      }),
    );
  });

  it("mantém o controle negativo quando o texto exato presente especial não aparece", async () => {
    const db = adminDouble();
    const row = evento("Ola! Me chamo Amanda e quero encomendar um presente");

    expect(await runAutomationForEvent(db.admin as never, row)).toMatchObject({
      status: "ok",
      detail: "no_match",
    });
    expect(adicionarTag).not.toHaveBeenCalled();
    expect(enviar).not.toHaveBeenCalled();
  });
});
