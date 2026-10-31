import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

import { fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";

const h = vi.hoisted(() => ({
  audit: vi.fn(),
  roleResult: {} as unknown,
  supportDenied: null as Response | null,
  mfaRequired: false,
  canViewIntegration: true,
}));

vi.mock("@/lib/audit", () => ({ audit: h.audit }));
vi.mock("@/lib/auth/server", () => ({
  loadAuthUser: vi.fn(async () => ({
    id: "20000000-0000-4000-8000-000000000002",
    idioma: "pt-BR",
    is_platform_admin: false,
    support: null,
  })),
  resolveActiveOrg: vi.fn(async () => ({
    orgId: "20000000-0000-4000-8000-000000000001",
    name: "Organização de teste",
    role: "manager",
  })),
  mfaEmDivida: vi.fn(async () => h.mfaRequired),
}));
vi.mock("@/lib/auth/require-role", () => ({
  requireRole: vi.fn(async () => h.roleResult),
}));
vi.mock("@/lib/impersonate/support", () => ({
  requireSupportWrite: vi.fn(async () => h.supportDenied),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({})) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({})) }));
vi.mock("@/lib/waha/client", () => ({ getWahaClient: vi.fn(() => ({})) }));
vi.mock("@/lib/channels/connect-waha", () => ({
  ChannelConnectionError: class ChannelConnectionError extends Error {},
  connectWahaChannel: vi.fn(),
}));
vi.mock("@/lib/channels/managed-qr", () => ({
  findManagedConnector: vi.fn(async () => null),
}));
vi.mock("@/lib/integrations/access", () => ({
  clientCanViewIntegration: vi.fn(async () => h.canViewIntegration),
  clientCanReconnectWhatsapp: vi.fn(async () => false),
}));

const organizationId = "20000000-0000-4000-8000-000000000001";
const userId = "20000000-0000-4000-8000-000000000002";

describe("recusas da conexão deixam rastro", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.supportDenied = null;
    h.mfaRequired = false;
    h.canViewIntegration = true;
    h.roleResult = {
      ok: true,
      user: { id: userId, idioma: "pt-BR", is_platform_admin: false, support: null },
      org: { orgId: organizationId, name: "Organização de teste", role: "manager" },
    };
  });

  it("recusa por papel no POST registra o motivo na organização e no usuário", async () => {
    h.roleResult = {
      ok: false,
      response: fail("forbidden_role", "Permissão insuficiente.", 403, {
        requestId: "20000000-0000-4000-8000-000000000003",
      }),
    };
    const { POST } = await import("@/app/api/v1/channel-sessions/route");

    const response = await POST(new Request("http://localhost/api/v1/channel-sessions", {
      method: "POST",
      body: JSON.stringify({ display_name: "Teste" }),
    }) as NextRequest);

    expect(response.status).toBe(403);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "channel.connect_failed",
      actorUserId: userId,
      organizationId,
      metadata: { reason: "forbidden_role", origin: "connections" },
    }));
  });

  it("recusa por MFA registra mfa_required", async () => {
    h.mfaRequired = true;
    const { POST } = await import("@/app/api/v1/channel-sessions/route");

    const response = await POST(new Request("http://localhost/api/v1/channel-sessions", {
      method: "POST",
      body: JSON.stringify({ display_name: "Teste" }),
    }) as NextRequest);

    expect(response.status).toBe(403);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "channel.connect_failed",
      actorUserId: userId,
      organizationId,
      metadata: { reason: "mfa_required", origin: "connections" },
    }));
  });

  it("403 do GET gerenciado registra a tentativa bloqueada", async () => {
    h.canViewIntegration = false;
    const { GET } = await import("@/app/api/v1/channel-sessions/managed/route");

    const response = await GET();

    expect(response.status).toBe(403);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "channel.connect_failed",
      actorUserId: userId,
      organizationId,
      metadata: { reason: "forbidden", origin: "managed_connector" },
    }));
  });
});
