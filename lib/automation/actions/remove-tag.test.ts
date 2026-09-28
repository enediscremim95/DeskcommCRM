import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/atendimento/origem-automacao", () => ({
  originFromAutomationEvent: vi.fn().mockResolvedValue("automation"),
}));

import { originFromAutomationEvent } from "@/lib/atendimento/origem-automacao";
import { getAction } from "@/lib/automation/actions";
import type { ActionCtx } from "@/lib/automation/types";
import "@/lib/automation/actions/remove-tag";

function harness() {
  let updatePayload: Record<string, unknown> | null = null;
  const query = {
    update: vi.fn((payload: Record<string, unknown>) => {
      updatePayload = payload;
      return query;
    }),
    eq: vi.fn(() => query),
    then: (
      onfulfilled?: (value: { error: null }) => unknown,
      onrejected?: (reason: unknown) => unknown,
    ) => Promise.resolve({ error: null }).then(onfulfilled, onrejected),
  };
  const from = vi.fn(() => query);
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
  return {
    admin: { from, rpc } as unknown as SupabaseClient,
    from,
    query,
    rpc,
    updatePayload: () => updatePayload,
  };
}

function ctx(admin: SupabaseClient, tags: string[]): ActionCtx {
  return {
    admin,
    organizationId: "11111111-1111-4111-8111-111111111111",
    ruleId: "22222222-2222-4222-8222-222222222222",
    ruleName: "Fluxo de teste",
    event: { id: "33333333-3333-4333-8333-333333333333" } as ActionCtx["event"],
    context: {
      lead: {
        id: "44444444-4444-4444-8444-444444444444",
        contact_id: "55555555-5555-4555-8555-555555555555",
        tags,
      },
    },
    requestId: "teste-remove-tag",
  };
}

describe("remove_tag", () => {
  beforeEach(() => vi.clearAllMocks());

  it("remove a tag, persiste a lista restante e emite o evento de remoção", async () => {
    const h = harness();
    const result = await getAction("remove_tag")!.execute(ctx(h.admin, ["aguardando", "cliente"]), {
      tags: ["aguardando", "aguardando"],
    });

    expect(result).toEqual({ type: "remove_tag", status: "success", detail: { removed: ["aguardando"] } });
    expect(h.from).toHaveBeenCalledWith("crm_leads");
    expect(h.updatePayload()).toMatchObject({ tags: ["cliente"] });
    expect(h.query.eq).toHaveBeenNthCalledWith(1, "id", "44444444-4444-4444-8444-444444444444");
    expect(h.query.eq).toHaveBeenNthCalledWith(2, "organization_id", "11111111-1111-4111-8111-111111111111");
    expect(h.rpc).toHaveBeenCalledWith("emit_event", expect.objectContaining({
      p_event_type: "lead.tag_removed",
      p_payload: expect.objectContaining({ removed_tags: ["aguardando"], tags: ["cliente"] }),
      p_metadata: { caused_by_rule: "22222222-2222-4222-8222-222222222222" },
    }));
  });

  it("não escreve nem emite evento quando a tag não existe", async () => {
    const h = harness();
    const result = await getAction("remove_tag")!.execute(ctx(h.admin, ["cliente"]), {
      tags: ["inexistente"],
    });

    expect(result).toEqual({ type: "remove_tag", status: "success", detail: { removed: [] } });
    expect(h.from).not.toHaveBeenCalled();
    expect(h.rpc).not.toHaveBeenCalled();
    expect(originFromAutomationEvent).not.toHaveBeenCalled();
  });
});
