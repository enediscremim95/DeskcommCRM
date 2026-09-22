import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

const ORG = "22222222-2222-4222-8222-222222222222";
const USER = "11111111-1111-4111-8111-111111111111";
const PRESET = "33333333-3333-4333-8333-333333333333";

function auth(platformAdmin: boolean) {
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: USER, is_platform_admin: platformAdmin, support: null },
    org: { orgId: ORG, role: "viewer", name: "Org" },
  } as never);
}

function patch(body: unknown) {
  return new NextRequest(`http://localhost/api/v1/reports/traffic/column-presets/${PRESET}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSupportWrite).mockResolvedValue(null);
});

describe("PATCH /api/v1/reports/traffic/column-presets/:id", () => {
  it("nega mutação a quem não é admin da plataforma", async () => {
    auth(false);
    const { PATCH } = await import("./route");
    const response = await PATCH(patch({ platform: "meta_ads", name: "Outro" }), {
      params: Promise.resolve({ id: PRESET }),
    });
    expect(response.status).toBe(403);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("filtra leitura e escrita por id e organização", async () => {
    auth(true);
    const filtros: Array<[string, unknown]> = [];
    let phase: "read" | "update" = "read";
    const chain = {
      select() {
        return chain;
      },
      update() {
        phase = "update";
        return chain;
      },
      eq(column: string, value: unknown) {
        filtros.push([`${phase}:${column}`, value]);
        return chain;
      },
      maybeSingle: vi.fn(async () => ({
        data: {
          id: PRESET,
          name: phase === "read" ? "KPI" : "Novo",
          metric_columns: ["spend"],
          platform: "meta_ads",
        },
        error: null,
      })),
    };
    vi.mocked(createAdminClient).mockReturnValue({ from: () => chain } as never);
    const { PATCH } = await import("./route");
    const response = await PATCH(patch({ platform: "meta_ads", name: "Novo" }), {
      params: Promise.resolve({ id: PRESET }),
    });
    expect(response.status).toBe(200);
    expect(filtros).toEqual(
      expect.arrayContaining([
        ["read:id", PRESET],
        ["read:organization_id", ORG],
        ["read:platform", "meta_ads"],
        ["update:id", PRESET],
        ["update:organization_id", ORG],
        ["update:platform", "meta_ads"],
      ]),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "traffic_dashboard.column_preset_updated",
        organizationId: ORG,
      }),
    );
  });
});
