import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireRole } from "@/lib/auth/require-role";
import { assinaturaDosAcessosAsOrganizacoes } from "@/lib/auth/assinatura-acessos-organizacoes";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    org: {
      orgId: "org-a",
      name: "Organização A",
      role: "admin",
      interface_settings: { preset: "completa" },
    },
    user: {
      organizations: [
        { organization_id: "org-b", organization_name: "Organização B", role: "admin" },
        { organization_id: "org-a", organization_name: "Organização A", role: "admin" },
      ],
    },
  } as never);
});

describe("GET /api/v1/auth/interface", () => {
  it("informa mudanças na lista sem expor IDs nem nomes de outras organizações", async () => {
    const { GET } = await import("./route");
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      organization_id: "org-a",
      organizations_count: 2,
      organizations_signature: assinaturaDosAcessosAsOrganizacoes(["org-a", "org-b"]),
    });
    expect(JSON.stringify(body)).not.toContain("Organização B");
    expect(body.data).not.toHaveProperty("organizations");
  });
});
