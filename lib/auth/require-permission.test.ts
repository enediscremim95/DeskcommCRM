import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireRole: vi.fn(), audit: vi.fn() }));

vi.mock("@/lib/auth/require-role", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));

import { requirePermission } from "@/lib/auth/require-permission";

function autorizado(role: "manager" | "admin", platform = false) {
  mocks.requireRole.mockResolvedValue({
    ok: true,
    user: {
      id: "11111111-1111-4111-8111-111111111111",
      is_platform_admin: platform,
      support: null,
    },
    org: {
      orgId: "22222222-2222-4222-8222-222222222222",
      name: "Empresa",
      role,
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("capacidades não lineares", () => {
  it("gerente pode gerir equipe e excluir leads, mas não apaga credencial de IA", async () => {
    autorizado("manager");
    expect((await requirePermission("team.manage")).ok).toBe(true);
    expect((await requirePermission("lead.delete")).ok).toBe(true);
    expect((await requirePermission("ai.credentials.delete")).ok).toBe(false);
  });

  it("administrador da organização gere equipe e credenciais, mas não exclui lead", async () => {
    autorizado("admin");
    const lead = await requirePermission("lead.delete", { requestId: "req-lead" });
    expect(lead.ok).toBe(false);
    // Excluir lead é a única coisa que o administrador não faz. Gerir equipe é
    // dele também: o dono restringiu a exclusão, não a gestão de pessoas.
    const team = await requirePermission("team.manage", { requestId: "req-team" });
    expect(team.ok).toBe(true);
    const credential = await requirePermission("ai.credentials.delete", {
      requestId: "req-credential",
    });
    expect(credential.ok).toBe(true);
    expect(mocks.audit).toHaveBeenCalledTimes(1);
  });

  it("administrador de plataforma continua distinto e acima das capacidades", async () => {
    autorizado("admin", true);
    expect((await requirePermission("team.manage")).ok).toBe(true);
    expect((await requirePermission("lead.delete")).ok).toBe(true);
    expect((await requirePermission("ai.credentials.delete")).ok).toBe(true);
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
