import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ guard: vi.fn(), mfa: vi.fn(), support: vi.fn(), provision: vi.fn(), select: vi.fn(), eq: vi.fn(), single: vi.fn() }));
vi.mock("@/lib/auth/requirePlatformAdmin", () => ({ requirePlatformAdmin: h.guard }));
vi.mock("@/lib/auth/server", () => ({ mfaEmDivida: h.mfa }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: h.support }));
vi.mock("@/lib/auth/provision-owner-access", () => ({ provisionOwnerAccess: h.provision }));
vi.mock("@/lib/env", () => ({ env: { NEXT_PUBLIC_APP_URL: "https://crm.example.test/" } }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => ({ select: h.select }) }) }));
import { GET, POST } from "@/app/api/v1/admin/tenants/[id]/owner-access/route";
const org = "a2180000-0000-4000-8000-000000000002";
const req = new Request("http://localhost/api/v1/admin/tenants/owner-access");
const context = (id = org) => ({ params: Promise.resolve({ id }) });
beforeEach(() => {
  vi.resetAllMocks();
  h.guard.mockResolvedValue({ user: { id: "authenticated-actor" }, platformAdmin: { scope: "full" } });
  h.mfa.mockResolvedValue(false);
  h.support.mockResolvedValue(null);
  h.provision.mockResolvedValue({ status: "sent", login_url: "https://crm.example.test/login", retryable: false });
  h.select.mockReturnValue({ eq: h.eq });
  h.eq.mockReturnValue({ maybeSingle: h.single });
  h.single.mockResolvedValue({ data: { status: "pending" }, error: null });
});
describe("owner-access guards", () => {
  it.each([GET, POST])("nega auth, scope readonly, MFA e ID inválido antes de efeitos", async (handler) => {
    h.guard.mockRejectedValueOnce(new Error("forbidden"));
    expect((await handler(req, context())).status).toBe(403);
    h.guard.mockResolvedValueOnce({ user: { id: "actor" }, platformAdmin: { scope: "support_readonly" } });
    expect((await handler(req, context())).status).toBe(403);
    h.mfa.mockResolvedValueOnce(true);
    expect((await handler(req, context())).status).toBe(403);
    expect((await handler(req, context("bad"))).status).toBe(400);
    expect(h.provision).not.toHaveBeenCalled();
    expect(h.select).not.toHaveBeenCalled();
  });
  it("respeita bloqueio de suporte antes do envio", async () => {
    h.support.mockResolvedValueOnce(new Response(null, { status: 403 }));
    expect((await POST(req, context())).status).toBe(403);
    expect(h.provision).not.toHaveBeenCalled();
  });
  it("usa ator autenticado e organização do path", async () => {
    expect((await POST(req, context())).status).toBe(200);
    expect(h.provision).toHaveBeenCalledWith({ actorId: "authenticated-actor", organizationId: org, requestId: expect.any(String) });
  });
  it("consulta apenas estado da organização e sinaliza retentativa após reload", async () => {
    const response = await GET(req, context());
    expect(h.select).toHaveBeenCalledWith("status");
    expect(h.eq).toHaveBeenCalledWith("organization_id", org);
    expect((await response.json()).data.owner_access).toEqual({ status: "failed", retryable: true, login_url: "https://crm.example.test/login" });
  });
  it("erro de leitura não parece ausência; ausência real retorna null", async () => {
    h.single.mockResolvedValueOnce({ error: { message: "unavailable" } });
    expect((await GET(req, context())).status).toBe(500);
    h.single.mockResolvedValueOnce({ data: null });
    expect((await (await GET(req, context())).json()).data.owner_access).toBeNull();
  });
});
