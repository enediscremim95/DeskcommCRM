import { NextRequest } from "next/server";
import { expect, it, vi } from "vitest";

import { POST } from "./route";

const { insert, consultarVersao, publicar } = vi.hoisted(() => ({
  insert: vi.fn(async () => ({ error: null })),
  consultarVersao: vi.fn(),
  publicar: vi.fn(),
}));

vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: async () => null }));
vi.mock("@/lib/auth/require-role", () => ({
  requireRole: async () => ({ ok: true, user: { id: "usuario-ficticio" }, org: { orgId: "org-ficticia" } }),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/mcp/tools", () => ({ VALID_TOOL_IDS: [] }));
vi.mock("@/lib/ai/agents/publish", () => ({ publishAgentVersion: publicar }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (tabela: string) => {
      if (tabela === "event_log") return { insert };
      const filtro = { eq: () => filtro, maybeSingle: consultarVersao };
      return { select: () => filtro };
    },
  }),
}));

it("registra a entidade e a versão publicadas para a organização autenticada", async () => {
  const agente = "11111111-1111-4111-8111-111111111111";
  const versao = "22222222-2222-4222-8222-222222222222";
  const publicado = "2026-11-23T12:00:00.000Z";
  consultarVersao.mockResolvedValue({ data: { agent_id: agente, tool_ids: [] } });
  publicar.mockResolvedValue({
    ok: true, agent_id: agente, version_id: versao, previous_version_id: null, published_at: publicado,
  });
  const req = new NextRequest(`http://localhost/api/v1/ai/agents/${agente}/publish`, {
    method: "POST",
    body: JSON.stringify({ version_id: versao }),
  });

  expect((await POST(req, { params: Promise.resolve({ id: agente }) })).status).toBe(200);
  expect(insert).toHaveBeenCalledExactlyOnceWith({
    organization_id: "org-ficticia",
    entity_kind: "ai_agent",
    entity_id: agente,
    event_type: "ai_agent.published",
    payload: {
      agent_id: agente,
      version_id: versao,
      previous_version_id: null,
      published_at: publicado,
    },
  });
});
