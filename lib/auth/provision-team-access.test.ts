import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  createUser: vi.fn(),
  deleteUser: vi.fn(),
  rpc: vi.fn(),
  send: vi.fn(),
  audit: vi.fn(),
  template: vi.fn(),
  deleteMembership: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  env: { NEXT_PUBLIC_APP_URL: "https://crm.example.test" },
}));
vi.mock("@/lib/audit", () => ({ audit: h.audit }));
vi.mock("@/lib/branding/saida", () => ({
  marcaDaSaida: async () => ({
    nome: "Marca",
    logoUrl: null,
    accent: "#334455",
    accentFg: "#ffffff",
    origens: { nome: "banco", cor: "banco" },
  }),
}));
vi.mock("@/lib/email/templates/invite", () => ({
  buildInviteEmail: h.template,
}));
vi.mock("@/lib/email/resend", () => ({ sendEmail: h.send }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: { admin: { createUser: h.createUser, deleteUser: h.deleteUser } },
    rpc: h.rpc,
    from: () => ({
      delete: () => ({
        eq: () => ({ eq: h.deleteMembership }),
      }),
    }),
  }),
}));

import { provisionTeamAccess } from "./provision-team-access";

const input = {
  email: "Pessoa@Example.Test",
  role: "agent" as const,
  interfaceSettings: { preset: "completa" as const },
  organizationId: "a2180000-0000-4000-8000-000000000001",
  orgName: "Acme",
  inviterId: "a2180000-0000-4000-8000-000000000002",
  requestId: "request-test",
  idioma: "pt-BR" as const,
};

describe("provisionamento do convite com senha", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    h.createUser.mockResolvedValue({ data: { user: { id: "user-new" } }, error: null });
    h.rpc.mockResolvedValue({ data: { id: "membership-new", changed: true }, error: null });
    h.template.mockImplementation(({ password }: { password: string }) => ({
      subject: "Acesso",
      html: `<p>${password}</p>`,
      text: password,
    }));
    h.send.mockResolvedValue({ ok: true, id: "email-1" });
    h.deleteMembership.mockResolvedValue({ error: null });
    h.deleteUser.mockResolvedValue({ data: {}, error: null });
  });

  it("entrega a senha somente ao provedor e nunca à auditoria ou retorno", async () => {
    const result = await provisionTeamAccess(input);
    const password = h.createUser.mock.calls[0]![0].password as string;

    expect(result).toEqual({
      ok: true,
      email: "pessoa@example.test",
      inviteId: expect.any(String),
      loginUrl: "https://crm.example.test/login",
    });
    expect(h.template).toHaveBeenCalledWith(expect.objectContaining({ password }));
    expect(JSON.stringify(h.send.mock.calls)).toContain(password);
    expect(JSON.stringify(h.audit.mock.calls)).not.toContain(password);
    expect(JSON.stringify(result)).not.toContain(password);
  });

  it("remove vínculo e usuário se o provedor recusar o e-mail", async () => {
    h.send.mockResolvedValue({ ok: false, error: "send_failed" });

    expect(await provisionTeamAccess(input)).toEqual({ ok: false, reason: "email_failed" });
    expect(h.deleteMembership).toHaveBeenCalledWith("user_id", "user-new");
    expect(h.deleteUser).toHaveBeenCalledWith("user-new");
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("preserva contas existentes para o convite legado", async () => {
    h.createUser.mockResolvedValue({ data: { user: null }, error: { status: 422 } });

    expect(await provisionTeamAccess(input)).toEqual({ ok: false, reason: "existing_user" });
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.send).not.toHaveBeenCalled();
  });
});
