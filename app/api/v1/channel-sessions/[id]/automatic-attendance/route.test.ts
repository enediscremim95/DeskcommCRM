import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { fail } from "@/lib/api/wrappers";
import { loadAuthUser } from "@/lib/auth/server";
import { requireRole } from "@/lib/auth/require-role";
import { definirAtendimentoAutomatico } from "@/lib/channels/atendimento-automatico";
import { createAdminClient } from "@/lib/supabase/admin";
import { GET, PATCH } from "./route";

vi.mock("@/lib/auth/server", () => ({ loadAuthUser: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/channels/atendimento-automatico", async (original) => {
  const actual = await original<typeof import("@/lib/channels/atendimento-automatico")>();
  return { ...actual, definirAtendimentoAutomatico: vi.fn() };
});

const org = "11111111-1111-4111-8111-111111111111";
const canal = "22222222-2222-4222-8222-222222222222";
const context = (id = canal) => ({ params: Promise.resolve({ id }) });
const req = (body: unknown = {}) => new NextRequest(
  `http://localhost/api/v1/channel-sessions/${canal}/automatic-attendance`,
  { method: "PATCH", body: JSON.stringify(body) },
);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadAuthUser).mockResolvedValue(null);
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: "33333333-3333-4333-8333-333333333333" },
    org: { orgId: org, role: "admin" },
  } as Awaited<ReturnType<typeof requireRole>>);
  const filters: Record<string, unknown> = {};
  const query = {
    select: () => query,
    eq: (field: string, value: unknown) => { filters[field] = value; return query; },
    is: (field: string, value: unknown) => { filters[field] = value; return query; },
    maybeSingle: async () => ({
      data: filters.organization_id === org && filters.id === canal
        ? { id: canal, automatic_attendance_enabled: false }
        : null,
      error: null,
    }),
  };
  vi.mocked(createAdminClient).mockReturnValue({ from: () => query } as never);
  vi.mocked(definirAtendimentoAutomatico).mockResolvedValue({ ok: true, enabled: true, changed: true });
});

describe("atendimento automático do canal", () => {
  it("exige a mesma capacidade manager usada para administrar canais", async () => {
    vi.mocked(requireRole).mockResolvedValue({ ok: false, response: fail("forbidden", "Acesso negado.", 403) });
    expect((await GET(req(), context())).status).toBe(403);
    expect((await PATCH(req({ enabled: true }), context())).status).toBe(403);
    expect(requireRole).toHaveBeenCalledWith("manager", expect.objectContaining({
      resource: "channel_sessions",
      allowPlatformAdmin: true,
    }));
  });

  it("lê somente o canal ativo da organização autenticada", async () => {
    const response = await GET(req(), context());
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ enabled: false });
    expect((await GET(req(), context(org))).status).toBe(404);
  });

  it("ignora organização do body e envia ator confiável para a escrita auditada", async () => {
    const response = await PATCH(req({ enabled: true, organization_id: canal }), context());
    expect(response.status).toBe(422);

    const valid = await PATCH(req({ enabled: true }), context());
    expect(valid.status).toBe(200);
    expect(definirAtendimentoAutomatico).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      organizationId: org,
      channelSessionId: canal,
      enabled: true,
      actor: expect.objectContaining({ actorUserId: "33333333-3333-4333-8333-333333333333" }),
    }));
  });

  it("suporte somente leitura não altera o canal", async () => {
    vi.mocked(loadAuthUser).mockResolvedValue({
      id: org,
      is_platform_admin: true,
      support: { organization_id: org, status: "active", access_mode: "support_readonly" },
    } as Awaited<ReturnType<typeof loadAuthUser>>);
    expect((await PATCH(req({ enabled: true }), context())).status).toBe(403);
    expect(definirAtendimentoAutomatico).not.toHaveBeenCalled();
  });
});
