import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ rpc: vi.fn(), create: vi.fn(), update: vi.fn(), invite: vi.fn(), send: vi.fn(), configured: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: h.rpc, auth: { admin: { createUser: h.create, updateUserById: h.update } } }) }));
vi.mock("@/lib/env", () => ({ env: { NEXT_PUBLIC_APP_URL: "https://crm.example.test/", INTERNAL_SECRET: "test-only-internal-secret-32chars" } }));
vi.mock("@/lib/auth/issue-invite", () => ({ issueInvite: h.invite }));
vi.mock("@/lib/email/resend", () => ({ isEmailConfigured: h.configured, sendEmail: h.send }));
vi.mock("@/lib/audit", () => ({ audit: h.audit }));
vi.mock("@/lib/branding/saida", () => ({ marcaDaSaida: async () => ({ nome: "CRM Teste" }) }));
import { provisionOwnerAccess } from "@/lib/auth/provision-owner-access";
import { sealOwnerPassword } from "@/lib/auth/owner-access-secret";
const org = "a2180000-0000-4000-8000-000000000002";
const input = { organizationId: org, actorId: "actor", requestId: "request" };
const password = "test-only-password";
function claimed(extra = {}) {
  return { status: "claimed", user_id: null, owned_user: false, email: "owner@example.test", org_name: "Empresa teste", owner_interface_settings: { preset: "simplificada" }, encrypted_password: sealOwnerPassword(password, "test-only-internal-secret-32chars", org), ...extra };
}
beforeEach(() => {
  vi.resetAllMocks();
  h.configured.mockReturnValue(true);
  h.rpc.mockImplementation(async (name: string) => ({ data: name.includes("claim") ? claimed() : true, error: null }));
  h.create.mockResolvedValue({ data: { user: { id: "created-user" } }, error: null });
  h.send.mockResolvedValue({ ok: true });
  h.invite.mockResolvedValue({ email_dispatched: true, accept_url: "https://crm.example.test/invite/private" });
});
describe("provisionamento do acesso do responsável", () => {
  it("vincula antes de enviar, devolve só estado e login, audita sem credenciais", async () => {
    expect(await provisionOwnerAccess(input)).toEqual({ status: "sent", retryable: false, login_url: "https://crm.example.test/login" });
    expect(h.create).toHaveBeenCalledWith(expect.objectContaining({ password, email_confirm: true, app_metadata: { crm_provisioning_org: org } }));
    expect(h.rpc).toHaveBeenNthCalledWith(2, "fn_complete_tenant_owner_access", expect.objectContaining({ p_user_id: "created-user", p_status: "linked" }));
    expect(h.rpc.mock.invocationCallOrder[1]).toBeLessThan(h.send.mock.invocationCallOrder[0]!);
    expect(h.send).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining(password) }));
    expect(JSON.stringify(h.audit.mock.calls)).not.toContain(password);
    expect(JSON.stringify(h.audit.mock.calls)).not.toContain("owner@example.test");
  });
  it("falha de envio permite retentar com a mesma senha sem reset ou conta duplicada", async () => {
    h.send.mockResolvedValueOnce({ ok: false });
    expect(await provisionOwnerAccess(input)).toMatchObject({ status: "failed", retryable: true });
    h.rpc.mockResolvedValueOnce({ data: claimed({ user_id: "created-user", owned_user: true }) });
    expect(await provisionOwnerAccess(input)).toMatchObject({ status: "sent" });
    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.update).not.toHaveBeenCalled();
    expect(h.send.mock.calls[0]![0].text).toBe(h.send.mock.calls[1]![0].text);
  });
  it("retoma crash após criação owned_user sem criar ou redefinir senha", async () => {
    h.rpc.mockResolvedValueOnce({ data: claimed({ user_id: "recovered-user", owned_user: true }) });
    expect(await provisionOwnerAccess(input)).toMatchObject({ status: "sent" });
    expect(h.create).not.toHaveBeenCalled();
    expect(h.update).not.toHaveBeenCalled();
    expect(h.rpc).toHaveBeenNthCalledWith(2, "fn_complete_tenant_owner_access", expect.objectContaining({ p_user_id: "recovered-user", p_status: "linked" }));
  });
  it.each([true, false])("conta existente conserva credenciais e recebe convite (envio %s)", async (sent) => {
    h.rpc.mockResolvedValueOnce({ data: claimed({ user_id: "existing-user" }) });
    h.invite.mockResolvedValueOnce({ email_dispatched: sent, accept_url: "https://crm.example.test/private" });
    const result = await provisionOwnerAccess(input);
    expect(result).toMatchObject({ status: sent ? "existing_user" : "failed", retryable: !sent });
    expect(result).not.toHaveProperty("accept_url");
    expect(h.invite).toHaveBeenCalledWith(expect.objectContaining({ organizationId: org, role: "admin", interfaceSettings: { preset: "simplificada" } }));
    expect(h.create).not.toHaveBeenCalled();
    expect(h.update).not.toHaveBeenCalled();
    expect(h.send).not.toHaveBeenCalled();
  });
  it.each([["busy", "failed", true], ["sent", "already_sent", false], ["existing_user", "existing_user", false]])("lease %s não repete efeitos", async (status, expected, retryable) => {
    h.rpc.mockResolvedValueOnce({ data: { status } });
    expect(await provisionOwnerAccess(input)).toMatchObject({ status: expected, retryable });
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.create).not.toHaveBeenCalled();
    expect(h.send).not.toHaveBeenCalled();
  });
  it("sem remetente configurado não cria conta nem reserva lease", async () => {
    h.configured.mockReturnValue(false);
    expect(await provisionOwnerAccess(input)).toMatchObject({ status: "failed", retryable: true });
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.create).not.toHaveBeenCalled();
  });
  it("falha de claim não cria conta", async () => {
    h.rpc.mockResolvedValueOnce({ error: { message: "unavailable" } });
    expect(await provisionOwnerAccess(input)).toMatchObject({ status: "failed", retryable: true });
    expect(h.create).not.toHaveBeenCalled();
  });
  it("falha de criação libera estado para retentativa sem enviar", async () => {
    h.create.mockResolvedValueOnce({ data: { user: null }, error: { message: "unavailable" } });
    expect(await provisionOwnerAccess(input)).toMatchObject({ status: "failed", retryable: true });
    expect(h.rpc).toHaveBeenLastCalledWith("fn_complete_tenant_owner_access", expect.objectContaining({ p_status: "failed" }));
    expect(h.send).not.toHaveBeenCalled();
  });
  it("falha de vínculo não entrega credenciais de conta sem acesso", async () => {
    h.rpc.mockResolvedValueOnce({ data: claimed() }).mockResolvedValueOnce({ data: false });
    expect(await provisionOwnerAccess(input)).toMatchObject({ status: "failed", retryable: true });
    expect(h.send).not.toHaveBeenCalled();
    expect(h.rpc).toHaveBeenLastCalledWith("fn_complete_tenant_owner_access", expect.objectContaining({ p_status: "failed" }));
  });
});
