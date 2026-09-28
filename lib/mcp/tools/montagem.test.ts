import { describe, expect, it } from "vitest";

import { ensureRole, ensureScope, McpAuthError } from "../auth";
import type { McpContext } from "../types";
import {
  crmCreateAiAgentDraftFromTemplate,
  crmListAiAgents,
  redigirCredenciaisDoTexto,
} from "./montagem";

const ORG = "11111111-1111-4111-8111-111111111111";
const TOKEN = "22222222-2222-4222-8222-222222222222";
const CHANNEL = "33333333-3333-4333-8333-333333333333";
const AGENT = "44444444-4444-4444-8444-444444444444";
const VERSION = "55555555-5555-4555-8555-555555555555";

function contexto(supabase: unknown): McpContext {
  return {
    organizationId: ORG,
    role: "manager",
    actor: { type: "user", id: TOKEN, role: "manager" },
    apiTokenId: TOKEN,
    requestId: "66666666-6666-4666-8666-666666666666",
    supabase,
  } as McpContext;
}

describe("escopo separado de montagem", () => {
  it("recusa montar sem mcp:configure, mesmo com leitura e escrita", () => {
    expect(crmCreateAiAgentDraftFromTemplate.requiresScope).toBe("mcp:configure");
    expect(() =>
      ensureScope(["mcp:read", "mcp:write"], crmCreateAiAgentDraftFromTemplate.requiresScope),
    ).toThrowError(McpAuthError);
  });

  it("aceita gerente e administrador no papel exigido", () => {
    expect(() => ensureRole("manager", crmCreateAiAgentDraftFromTemplate.requiresRole)).not.toThrow();
    expect(() => ensureRole("admin", crmCreateAiAgentDraftFromTemplate.requiresRole)).not.toThrow();
  });
});

describe("montagem por modelo", () => {
  it("cria versão rascunho, não publica e registra o token MCP", async () => {
    const inserts: Record<string, Record<string, unknown>> = {};

    function from(table: string) {
      let operation = "read";
      const query = {
        select: () => query,
        eq: () => query,
        is: () => query,
        insert: (payload: Record<string, unknown>) => {
          operation = "insert";
          inserts[table] = payload;
          return query;
        },
        delete: () => query,
        maybeSingle: async () =>
          table === "channel_sessions"
            ? { data: { id: CHANNEL }, error: null }
            : { data: null, error: null },
        single: async () => {
          if (table === "ai_agents" && operation === "insert") {
            return {
              data: { id: AGENT, name: inserts.ai_agents?.name, description: inserts.ai_agents?.description },
              error: null,
            };
          }
          if (table === "ai_agent_versions" && operation === "insert") {
            return {
              data: {
                id: VERSION,
                version_number: 1,
                status: "draft",
                provisioning_origin: "mcp",
                mcp_api_token_id: TOKEN,
                mcp_change_summary: inserts.ai_agent_versions?.mcp_change_summary,
              },
              error: null,
            };
          }
          return { data: null, error: null };
        },
      };
      return query;
    }

    const result = await crmCreateAiAgentDraftFromTemplate.handler(
      {
        template_id: "servicos",
        channel_session_id: CHANNEL,
        provider: "anthropic",
        model: "claude-sonnet",
      },
      contexto({ from } as never),
    );

    expect(result).toMatchObject({
      version_id: VERSION,
      status: "draft",
      published: false,
      origin: "mcp",
    });
    expect(inserts.ai_agents).toMatchObject({ is_active: false, is_default: false });
    expect(inserts.ai_agents).not.toHaveProperty("published_version_id");
    expect(inserts.ai_agent_versions).toMatchObject({
      status: "draft",
      provisioning_origin: "mcp",
      mcp_api_token_id: TOKEN,
    });
  });
});

describe("listagem segura de agentes", () => {
  it("redige segredo acidental em texto configurável", () => {
    const chaveFicticia = "sk-" + "projeto_abcdefghijklmnop";
    const texto = redigirCredenciaisDoTexto(
      `Use token=segredo-muito-longo-123 e ${chaveFicticia}`,
    );
    expect(texto).not.toContain("segredo-muito-longo-123");
    expect(texto).not.toContain(chaveFicticia);
  });

  it("não devolve chave, token nem credencial", async () => {
    const responses: Record<string, unknown[]> = {
      ai_agents: [
        {
          id: AGENT,
          name: "Atendimento",
          description: "Qualificar interessados",
          published_version_id: VERSION,
          credential_id: "nao-deve-vazar",
          token_hash: "nao-deve-vazar",
        },
      ],
      ai_agent_versions: [
        { id: VERSION, agent_id: AGENT, skill_names: ["agendamento"] },
      ],
      ai_router_members: [],
    };

    function from(table: string) {
      const query = {
        select: () => query,
        eq: () => query,
        is: () => query,
        order: () => query,
        in: () => query,
        or: () => query,
        then: (resolve: (value: unknown) => void) =>
          resolve({ data: responses[table] ?? [], error: null }),
      };
      return query;
    }

    const result = await crmListAiAgents.handler({}, contexto({ from } as never));
    const serialized = JSON.stringify(result);

    expect(result).toEqual({
      agents: [
        {
          id: AGENT,
          name: "Atendimento",
          objective: "Qualificar interessados",
          published: true,
          skills: ["agendamento"],
          routers: [],
        },
      ],
    });
    expect(serialized).not.toContain("credential");
    expect(serialized).not.toContain("token");
    expect(serialized).not.toContain("nao-deve-vazar");
  });
});
