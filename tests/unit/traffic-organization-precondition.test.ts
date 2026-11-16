import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ requireRole: vi.fn(), createAdminClient: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/env", () => ({ env: {} }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/windsor/client", () => ({ fetchWindsorCampaignReach: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn() }));
vi.mock("@/lib/integrations/access", () => ({ clientCanViewIntegration: vi.fn() }));
import { GET } from "@/app/api/v1/reports/traffic/route";

const currentOrg = "19920735-776c-40a9-8d92-f8ae1e117d65";
const oldOrg = "4db279eb-55d6-44a3-870f-9909f19f8b87";
function request(expected?: string) {
  return new NextRequest(
    "https://crm.example/api/v1/reports/traffic?from=2026-11-09&to=2026-11-16",
    {
      headers: expected ? { "x-report-organization": expected } : {},
    },
  );
}

describe("relatório com organização alterada em outra aba", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireRole.mockResolvedValue({
      ok: true,
      org: { orgId: currentOrg },
      user: { is_platform_admin: true },
    });
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    mocks.createAdminClient.mockReturnValue({ from: vi.fn().mockReturnValue(query) });
  });

  it.each([currentOrg, oldOrg])("retorna conflito antes de consultar dados, organização ativa %s", async active => {
    mocks.requireRole.mockResolvedValue({ok:true,org:{orgId:active},user:{is_platform_admin:true}});
    const response = await GET(request(active===currentOrg ? oldOrg : currentOrg));
    expect(response.status).toBe(409);
    expect((await response.json()).error.details.reason).toBe("active_organization_changed");
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.requireRole).toHaveBeenCalledWith("viewer", expect.any(Object));
  });

  it.each([undefined, currentOrg])(
    "preserva a configuração ausente real (header %s)",
    async (expected) => {
      const response = await GET(request(expected));
      expect(response.status).toBe(404);
      expect((await response.json()).error.code).toBe("not_found");
    },
  );

  it("não permite que o header contorne autorização", async () => {
    mocks.requireRole.mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 403 }),
    });
    expect((await GET(request(oldOrg))).status).toBe(403);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});
