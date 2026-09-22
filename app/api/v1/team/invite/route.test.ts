import { expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({ provision: vi.fn() }));

vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: async () => null }));
vi.mock("@/lib/auth/require-role", () => ({
  requireRole: async () => ({
    ok: true,
    user: { id: "user-admin", email: "admin@example.test", full_name: "Admin", idioma: "pt-BR" },
    org: { orgId: "org-1", name: "Acme", role: "admin" },
  }),
}));
vi.mock("@/lib/schemas", () => ({
  inviteMemberSchema: {},
  validateRequest: async () => ({ invitations: [{ email: "new@example.test", role: "agent" }] }),
}));
vi.mock("@/lib/email/resend", () => ({ isEmailConfigured: () => false }));
vi.mock("@/lib/auth/provision-team-access", () => ({ provisionTeamAccess: h.provision }));
vi.mock("@/lib/auth/issue-invite", () => ({ issueInvite: vi.fn() }));
vi.mock("@/lib/audit", () => ({ isServiceRoleConfigured: () => false }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { POST } from "./route";

it("sem provedor de e-mail falha antes de criar qualquer acesso", async () => {
  const response = await POST(
    new NextRequest("https://crm.example.test/api/v1/team/invite", {
      method: "POST",
      body: JSON.stringify({}),
    }),
  );

  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    error: {
      code: "unavailable",
      message: "Configure o envio de e-mail antes de convidar uma pessoa.",
    },
  });
  expect(h.provision).not.toHaveBeenCalled();
});
