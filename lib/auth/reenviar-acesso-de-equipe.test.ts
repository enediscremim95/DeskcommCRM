import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  memberships: vi.fn(),
  getUserById: vi.fn(),
  updateUserById: vi.fn(),
  send: vi.fn(),
  audit: vi.fn(),
  template: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  env: { NEXT_PUBLIC_APP_URL: "https://crm.example.test/" },
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
vi.mock("@/lib/email/templates/invite", () => ({ buildInviteEmail: h.template }));
vi.mock("@/lib/email/resend", () => ({ sendEmail: h.send }));
vi.mock("./provisional-password", () => ({
  generateProvisionalPassword: () => "SenhaProvisoria9",
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: {
      admin: {
        getUserById: h.getUserById,
        updateUserById: h.updateUserById,
      },
    },
    from: () => ({
      select: () => ({
        eq: () => ({ is: h.memberships }),
      }),
    }),
  }),
}));

import { reenviarAcessoDeEquipe } from "./reenviar-acesso-de-equipe";

const input = {
  organizationId: "a2180000-0000-4000-8000-000000000001",
  orgName: "Acme",
  email: "Pessoa@Example.Test",
  actorUserId: "a2180000-0000-4000-8000-000000000002",
  requestId: "request-test",
  idioma: "pt-BR" as const,
};

describe("reenvio de acesso da equipe", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    h.memberships.mockResolvedValue({
      data: [{ id: "membership-1", user_id: "user-1" }],
      error: null,
    });
    h.getUserById.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          email: "pessoa@example.test",
          last_sign_in_at: null,
        },
      },
      error: null,
    });
    h.updateUserById.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    h.template.mockImplementation(({ password }: { password: string }) => ({
      subject: "Acesso",
      html: `<p>${password}</p>`,
      text: password,
    }));
    h.send.mockResolvedValue({ ok: true, id: "email-1" });
  });

  it("gera nova senha e envia acesso para membro ativo que nunca entrou", async () => {
    const result = await reenviarAcessoDeEquipe(input);

    expect(h.updateUserById).toHaveBeenCalledWith("user-1", {
      password: "SenhaProvisoria9",
      email_confirm: true,
    });
    expect(h.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "pessoa@example.test",
        idempotencyKey: expect.stringMatching(/^team-reaccess\/[0-9a-f-]+$/),
        tags: [
          { name: "kind", value: "team_reaccess" },
          { name: "org", value: input.organizationId },
        ],
      }),
    );
    expect(result).toEqual({
      ok: true,
      email: "pessoa@example.test",
      inviteId: expect.any(String),
      loginUrl: "https://crm.example.test/login",
    });
  });

  it("recusa quem já entrou e não troca a senha", async () => {
    h.getUserById.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          email: "pessoa@example.test",
          last_sign_in_at: "2026-10-07T12:00:00.000Z",
        },
      },
      error: null,
    });

    expect(await reenviarAcessoDeEquipe(input)).toEqual({ ok: false, reason: "ja_acessou" });
    expect(h.updateUserById).not.toHaveBeenCalled();
    expect(h.send).not.toHaveBeenCalled();
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("recusa quem não é membro ativo da organização", async () => {
    h.memberships.mockResolvedValue({ data: [], error: null });

    expect(await reenviarAcessoDeEquipe(input)).toEqual({ ok: false, reason: "nao_membro" });
    expect(h.getUserById).not.toHaveBeenCalled();
    expect(h.updateUserById).not.toHaveBeenCalled();
    expect(h.send).not.toHaveBeenCalled();
  });

  it("devolve email_failed se a senha mudou mas o envio falhou", async () => {
    h.send.mockResolvedValue({ ok: false, error: "send_failed" });

    expect(await reenviarAcessoDeEquipe(input)).toEqual({ ok: false, reason: "email_failed" });
    expect(h.updateUserById).toHaveBeenCalledOnce();
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("nunca põe a senha em auditoria, logs ou retorno", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await reenviarAcessoDeEquipe(input);
    const logs = [...info.mock.calls, ...warn.mock.calls, ...error.mock.calls];

    expect(h.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "member.invited",
        metadata: { reissued: true },
      }),
    );
    expect(JSON.stringify(h.audit.mock.calls)).not.toContain("SenhaProvisoria9");
    expect(JSON.stringify(logs)).not.toContain("SenhaProvisoria9");
    expect(JSON.stringify(result)).not.toContain("SenhaProvisoria9");

    info.mockRestore();
    warn.mockRestore();
    error.mockRestore();
  });
});
