import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  emailConfigured: vi.fn(),
  validateRequest: vi.fn(),
  reaccess: vi.fn(),
  provision: vi.fn(),
  issueInvite: vi.fn(),
  serviceConfigured: vi.fn(),
  memberships: vi.fn(),
  getUserById: vi.fn(),
}));

vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: async () => null }));
vi.mock("@/lib/auth/require-permission", () => ({
  requirePermission: async () => ({
    ok: true,
    user: { id: "user-admin", email: "admin@example.test", full_name: "Admin", idioma: "pt-BR" },
    org: { orgId: "org-1", name: "Acme", role: "admin" },
  }),
}));
vi.mock("@/lib/schemas", () => ({
  inviteMemberSchema: {},
  validateRequest: h.validateRequest,
}));
vi.mock("@/lib/email/resend", () => ({ isEmailConfigured: h.emailConfigured }));
vi.mock("@/lib/auth/reenviar-acesso-de-equipe", () => ({
  reenviarAcessoDeEquipe: h.reaccess,
}));
vi.mock("@/lib/auth/provision-team-access", () => ({ provisionTeamAccess: h.provision }));
vi.mock("@/lib/auth/issue-invite", () => ({ issueInvite: h.issueInvite }));
vi.mock("@/lib/audit", () => ({ isServiceRoleConfigured: h.serviceConfigured }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: { admin: { getUserById: h.getUserById } },
    from: () => ({
      select: () => ({
        eq: () => ({ is: h.memberships }),
      }),
    }),
  }),
}));

import { POST } from "./route";

function request(): NextRequest {
  return new NextRequest("https://crm.example.test/api/v1/team/invite", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

describe("POST /api/v1/team/invite", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    h.emailConfigured.mockReturnValue(true);
    h.serviceConfigured.mockReturnValue(true);
    h.validateRequest.mockResolvedValue({
      invitations: [{ email: "member@example.test", role: "agent" }],
    });
    h.memberships.mockResolvedValue({ data: [{ user_id: "member-1" }], error: null });
    h.getUserById.mockResolvedValue({
      data: { user: { id: "member-1", email: "member@example.test" } },
      error: null,
    });
  });

  it("sem provedor de e-mail falha antes de criar qualquer acesso", async () => {
    h.emailConfigured.mockReturnValue(false);

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: {
        code: "unavailable",
        message: "Configure o envio de e-mail antes de convidar uma pessoa.",
      },
    });
    expect(h.reaccess).not.toHaveBeenCalled();
    expect(h.provision).not.toHaveBeenCalled();
  });

  it("conta como enviado o acesso reemitido para quem nunca entrou", async () => {
    h.reaccess.mockResolvedValue({
      ok: true,
      email: "member@example.test",
      inviteId: "reaccess-1",
      loginUrl: "https://crm.example.test/login",
    });

    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      data: {
        sent: [
          {
            email: "member@example.test",
            invite_id: "reaccess-1",
            expires_at: null,
            email_dispatched: true,
            accept_url: "https://crm.example.test/login",
          },
        ],
        failed: [],
      },
    });
    expect(h.reaccess).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        email: "member@example.test",
        actorUserId: "user-admin",
      }),
    );
    expect(h.provision).not.toHaveBeenCalled();
  });

  it("mantém already_member para quem já entrou e não tenta trocar a senha", async () => {
    h.reaccess.mockResolvedValue({ ok: false, reason: "ja_acessou" });

    const response = await POST(request());

    expect(await response.json()).toEqual({
      data: {
        sent: [],
        failed: [{ email: "member@example.test", reason: "already_member" }],
      },
    });
    expect(h.provision).not.toHaveBeenCalled();
    expect(h.issueInvite).not.toHaveBeenCalled();
  });
});
