import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

import { PATCH } from "./route";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/integrations/access", () => ({ clientCanViewIntegration: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/windsor/client", () => ({ fetchWindsorCampaignReach: vi.fn() }));

const ORG = "22222222-2222-4222-8222-222222222222";
const USER = "11111111-1111-4111-8111-111111111111";

function auth(platformAdmin: boolean) {
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: USER, is_platform_admin: platformAdmin, support: null },
    org: { orgId: ORG, role: "viewer", name: "Org" },
  } as never);
}

function request(metrics: string[]) {
  return new NextRequest("http://localhost/api/v1/reports/traffic", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ priority_metrics: metrics }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSupportWrite).mockResolvedValue(null);
});

describe("permissão do padrão organizacional do relatório", () => {
  it("nega ao cliente a alteração das métricas padrão da organização", async () => {
    auth(false);

    const response = await PATCH(request(["spend", "leads"]));

    expect(response.status).toBe(403);
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("admin da plataforma grava o padrão somente na organização ativa", async () => {
    auth(true);
    const filters: Array<[string, unknown]> = [];
    const chain = {
      update: vi.fn(() => chain),
      eq: vi.fn((column: string, value: unknown) => {
        filters.push([column, value]);
        return filters.length === 2 ? Promise.resolve({ error: null }) : chain;
      }),
    };
    vi.mocked(createAdminClient).mockReturnValue({ from: () => chain } as never);

    const response = await PATCH(request(["spend", "leads"]));

    expect(response.status).toBe(200);
    expect(filters).toEqual([
      ["organization_id", ORG],
      ["enabled", true],
    ]);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "traffic_dashboard.priority_metrics_updated",
        organizationId: ORG,
        actingAsPlatformAdmin: true,
      }),
    );
  });
});
