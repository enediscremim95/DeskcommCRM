import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireRole, rpc } = vi.hoisted(() => ({ requireRole: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: async () => null }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));

import { GET, POST } from "./route";

const id = "11111111-1111-4111-8111-111111111111";
const ctx = { params: Promise.resolve({ id }) };
const endpoint = "http://localhost/api/v1/ai/credentials/default";
const choice = { model_id: "modelo-ficticio", revision: "a".repeat(64) };
const request = (body: unknown) => new Request(endpoint, {
  method: "POST",
  body: JSON.stringify(body),
});

beforeEach(() => {
  vi.clearAllMocks();
  requireRole.mockResolvedValue({ ok: true, user: { id: "ator" }, org: { orgId: "org-ativa" } });
  rpc.mockResolvedValue({ data: { applied: true }, error: null });
});

describe("troca da credencial padrão", () => {
  it("exige admin antes de consultar ou alterar a troca", async () => {
    requireRole.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    expect((await GET(new Request(endpoint), ctx)).status).toBe(403);
    expect((await POST(request(choice), ctx)).status).toBe(403);
    expect(requireRole).toHaveBeenCalledWith("admin", expect.anything());
    expect(rpc).not.toHaveBeenCalled();
  });

  it("consulta a prévia sem enviar um modelo para aplicação", async () => {
    expect((await GET(new Request(endpoint), ctx)).status).toBe(200);
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc.mock.lastCall?.[1]).not.toHaveProperty("p_model_id");
  });

  it("encaminha a confirmação em uma única transação da organização ativa", async () => {
    expect((await POST(request(choice), ctx)).status).toBe(200);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("fn_usar_credencial_ia_padrao", {
      p_org_id: "org-ativa", p_actor_id: "ator", p_credential_id: id,
      p_purposes: expect.arrayContaining(["agent_turn", "sentiment_classify"]),
      p_request_id: expect.any(String), p_model_id: choice.model_id, p_revision: choice.revision,
    });
    expect(rpc.mock.lastCall?.[1].p_purposes).not.toEqual(expect.arrayContaining(["followup_classify"]));
    expect(rpc.mock.lastCall?.[1].p_purposes).not.toEqual(expect.arrayContaining(["embedding_indexar"]));
    expect(rpc.mock.lastCall?.[1].p_purposes).not.toEqual(expect.arrayContaining(["percepcao_de_audio"]));
  });

  it("rejeita tentativa de escolher outra organização", async () => {
    expect((await POST(request({ ...choice, organization_id: "outra" }), ctx)).status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each(["plan_changed", "channel_session_offline"])("expõe conflito %s sem repetir a troca", async (message) => {
    rpc.mockResolvedValue({ error: { message } });
    expect((await POST(request(choice), ctx)).status).toBe(409);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
