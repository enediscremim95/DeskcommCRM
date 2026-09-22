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

function request(body: unknown) {
  return new NextRequest("http://localhost/api/v1/reports/traffic/column-presets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSupportWrite).mockResolvedValue(null);
});

describe("GET /api/v1/reports/traffic/column-presets", () => {
  it("exige uma plataforma conhecida antes de consultar o tenant", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("http://localhost/api/v1/reports/traffic/column-presets"),
    );
    expect(response.status).toBe(400);
    expect(requireRole).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/reports/traffic/column-presets", () => {
  it("nega mutação ao cliente, inclusive admin da organização", async () => {
    auth(false);
    const { POST } = await import("./route");
    const response = await POST(request({ name: "KPI", platform: "meta_ads", columns: ["spend"] }));
    expect(response.status).toBe(403);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("recusa colunas duplicadas antes de escrever", async () => {
    auth(true);
    const { POST } = await import("./route");
    const response = await POST(
      request({ name: "KPI", platform: "meta_ads", columns: ["spend", "spend"] }),
    );
    expect(response.status).toBe(400);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("grava sempre na organização ativa e audita a criação", async () => {
    auth(true);
    let inserted: Record<string, unknown> | null = null;
    const chain = {
      insert(value: Record<string, unknown>) {
        inserted = value;
        return chain;
      },
      select() {
        return chain;
      },
      single: vi.fn(async () => ({
        data: {
          id: PRESET,
          name: "KPI",
          metric_columns: ["spend", "leads"],
          platform: "meta_ads",
        },
        error: null,
      })),
    };
    vi.mocked(createAdminClient).mockReturnValue({ from: () => chain } as never);
    const { POST } = await import("./route");
    const response = await POST(
      request({ name: "KPI", platform: "meta_ads", columns: ["spend", "leads"] }),
    );
    expect(response.status).toBe(201);
    expect(inserted).toMatchObject({
      organization_id: ORG,
      platform: "meta_ads",
      created_by: USER,
      updated_by: USER,
    });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "traffic_dashboard.column_preset_created",
        organizationId: ORG,
        resourceId: PRESET,
      }),
    );
  });

  it("recusa métrica exclusiva do Meta numa predefinição do Google", async () => {
    auth(true);
    const { POST } = await import("./route");
    const response = await POST(
      request({
        name: "Mensagens",
        platform: "google_ads",
        columns: ["spend", "messaging_conversations"],
      }),
    );
    expect(response.status).toBe(400);
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
