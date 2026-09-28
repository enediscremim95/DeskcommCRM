import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/audit", () => ({ audit: vi.fn().mockResolvedValue(undefined) }));

import {
  crmApplyAutomationModel,
  crmCreateAutomationRule,
  crmDescribeAutomationOptions,
  crmListAutomationRules,
  crmSetAutomationRuleActive,
  crmUpdateAutomationRule,
} from "@/lib/mcp/tools/automation";
import { allTools } from "@/lib/mcp/tools";
import type { McpContext } from "@/lib/mcp/types";

const ORG = "11111111-1111-4111-8111-111111111111";
const CANAL = "33333333-3333-4333-8333-333333333333";

describe("família MCP de automação", () => {
  it("registra leitura, explicação, escrita, modelo e ativação nos escopos corretos", () => {
    const esperadas = [
      [crmListAutomationRules, "mcp:read"],
      [crmDescribeAutomationOptions, "mcp:read"],
      [crmCreateAutomationRule, "mcp:write"],
      [crmUpdateAutomationRule, "mcp:write"],
      [crmApplyAutomationModel, "mcp:write"],
      [crmSetAutomationRuleActive, "mcp:write"],
    ] as const;
    for (const [tool, scope] of esperadas) {
      expect(tool.requiresScope).toBe(scope);
      expect(allTools.some((item) => item.name === tool.name)).toBe(true);
    }
    expect(crmCreateAutomationRule.requiresRole).toBe("ai_operator");
    expect(crmUpdateAutomationRule.requiresRole).toBe("ai_operator");
    expect(crmApplyAutomationModel.requiresRole).toBe("ai_operator");
    expect(crmSetAutomationRuleActive.requiresRole).toBe("manager");
  });

  it("ensina somente o vocabulário real e nomeia todas as guardas de envio", async () => {
    const result = (await crmDescribeAutomationOptions.handler({}, {} as McpContext)) as {
      triggers: unknown[];
      actions: unknown[];
      guards: Record<string, string>;
    };
    expect(result.triggers).toHaveLength(5);
    expect(result.actions).toHaveLength(7);
    const texto = `${crmCreateAutomationRule.description} ${Object.values(result.guards).join(" ")}`;
    expect(texto).toMatch(/janela de horário/i);
    expect(texto).toMatch(/limite/i);
    expect(texto).toMatch(/número/i);
    expect(texto).toMatch(/consentimento/i);
  });

  it("cria a regra na organização do contexto e sempre pausada", async () => {
    let inserido: Record<string, unknown> | null = null;
    const from = (table: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: table === "channel_sessions" ? { id: CANAL } : null, error: null }),
        insert: (value: Record<string, unknown>) => { inserido = value; return chain; },
        single: async () => ({
          data: {
            id: "44444444-4444-4444-8444-444444444444",
            run_count: 0,
            last_run_at: null,
            last_change_actor_kind: "ai",
            last_change_at: "2026-09-26T12:00:00Z",
            ...inserido,
          },
          error: null,
        }),
      };
      return chain;
    };
    const ctx = {
      organizationId: ORG,
      role: "manager",
      actor: { type: "ai_agent", id: "run-1", role: "manager", api_token_id: "tok" },
      apiTokenId: "tok",
      requestId: "req-mcp-automation",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: { from } as any,
    } as McpContext;

    await crmCreateAutomationRule.handler(
      {
        name: "Primeiro contato",
        trigger_event: "lead.created",
        conditions: [],
        actions: [{ type: "send_whatsapp_message", config: { channel_session_id: CANAL, template: "Olá" } }],
      },
      ctx,
    );

    expect(inserido).toMatchObject({ organization_id: ORG, is_active: false, created_by_user_id: null });
    expect(inserido).not.toHaveProperty("organization_id", "outra-org");
  });

  it("editar filtra pela organização do contexto e pausa a regra para revisão", async () => {
    const ruleId = "44444444-4444-4444-8444-444444444444";
    let atualizado: Record<string, unknown> | null = null;
    const filtros: Array<[string, unknown]> = [];
    const from = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chain: any = {
        select: () => chain,
        eq: (campo: string, valor: unknown) => { filtros.push([campo, valor]); return chain; },
        maybeSingle: async () => ({ data: { id: ruleId, name: "Antiga", is_active: true }, error: null }),
        update: (value: Record<string, unknown>) => { atualizado = value; return chain; },
        single: async () => ({
          data: {
            id: ruleId,
            name: "Nova",
            trigger_event: "lead.created",
            conditions: [],
            actions: [{ type: "add_tag", config: { tags: ["novo"] } }],
            run_count: 0,
            last_run_at: null,
            last_change_actor_kind: "ai",
            last_change_at: "2026-09-26T12:00:00Z",
            ...atualizado,
          },
          error: null,
        }),
      };
      return chain;
    };
    const ctx = {
      organizationId: ORG,
      role: "ai_operator",
      actor: { type: "ai_agent", id: "run-2", role: "ai_operator", api_token_id: "tok" },
      apiTokenId: "tok",
      requestId: "req-mcp-automation-update",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: { from } as any,
    } as McpContext;

    await crmUpdateAutomationRule.handler({ rule_id: ruleId, name: "Nova" }, ctx);

    expect(atualizado).toMatchObject({ name: "Nova", is_active: false });
    expect(filtros).toContainEqual(["organization_id", ORG]);
  });
});
