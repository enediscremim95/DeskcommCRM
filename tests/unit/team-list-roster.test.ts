/**
 * G6-06 (INB-14) — GET /api/v1/team volta a listar o roster COMPLETO pro manager.
 *
 * O bug era 100% RLS (user_orgs_select dava org-wide read só ao admin →
 * manager caía no self-read e a query user-scoped devolvia 1 linha). A rota
 * NUNCA filtrou por user_id — ela faz um SELECT org-scoped e depende só do que
 * o client RLS-scoped entrega. Migration 0044 corrige a RLS (provado no
 * invariante gov-1b-team-manager-read); este teste prova, contra o Route
 * Handler REAL (auth/Supabase mockados), que a rota lista TODOS os membros que
 * o client devolve pro manager — sem cap, sem self-filter.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import type { AuthUser } from "@/lib/auth/types";

const routeMocks = vi.hoisted(() => ({
  isServiceRoleConfigured: vi.fn(() => false),
  getUserById: vi.fn(),
}));

vi.mock("@/lib/auth/server", () => ({
  loadAuthUser: vi.fn(),
  resolveActiveOrg: vi.fn(),
  // Sessão sem dívida de MFA: estes testes medem RBAC, não o gate de
  // segundo fator (que tem suíte própria em require-role-mfa.test.ts).
  mfaEmDivida: vi.fn(async () => false),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
// admin.ts valida env no load; a rota só o chama quando isServiceRoleConfigured()
// (mockado false) — mock evita a validação de env no import.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ auth: { admin: { getUserById: routeMocks.getUserById } } }),
}));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async () => undefined),
  isServiceRoleConfigured: routeMocks.isServiceRoleConfigured,
  hashEmail: (e: string) => e,
}));

const MANAGER_ID = "cccccccc-1111-4000-8000-000000000004";
const ORG_ID = "cccccccc-0000-4000-8000-000000000001";

const ROSTER = [
  { user_id: "u-viewer", role: "viewer" },
  { user_id: "u-agent-a", role: "agent" },
  { user_id: "u-agent-b", role: "agent" },
  { user_id: MANAGER_ID, role: "manager" },
  { user_id: "u-admin", role: "admin" },
].map((m) => ({
  ...m,
  invited_at: null,
  accepted_at: "2026-07-18T00:00:00Z",
  revoked_at: null,
  created_at: "2026-07-18T00:00:00Z",
}));

/** Capta o filtro aplicado à query pra provar que é org-scoped e SEM self-filter. */
interface QuerySpy {
  eqCalls: Array<[string, unknown]>;
}

function makeSupabaseStub(rows: Array<Record<string, unknown>>, spy: QuerySpy) {
  const selectChain = {
    eq: (col: string, val: unknown) => {
      spy.eqCalls.push([col, val]);
      return selectChain;
    },
    is: () => selectChain,
    order: () => Promise.resolve({ data: rows, error: null }),
  };
  return {
    from: (table: string) => {
      if (table !== "user_organizations") throw new Error(`unexpected table ${table}`);
      return { select: () => selectChain };
    },
    // requireRole resolve o role efetivo do banco.
    rpc: async (fn: string) =>
      fn === "fn_user_role_in_org" ? { data: "manager", error: null } : { data: null, error: null },
  };
}

function managerSession(rows: Array<Record<string, unknown>>, spy: QuerySpy) {
  const user: AuthUser = {
    id: MANAGER_ID,
    email: "manager@example.com",
    full_name: null,
    avatar_url: null,
    is_platform_admin: false,
    idioma: "pt-BR" as const,
    organizations: [{ organization_id: ORG_ID, organization_name: "Org", role: "manager" }],
  };
  vi.mocked(loadAuthUser).mockResolvedValue(user);
  vi.mocked(resolveActiveOrg).mockResolvedValue({ orgId: ORG_ID, name: "Org", role: "manager" });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(createClient).mockResolvedValue(makeSupabaseStub(rows, spy) as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  routeMocks.isServiceRoleConfigured.mockReturnValue(false);
});

describe("GET /api/v1/team — roster completo para manager (G6-06)", () => {
  it("manager recebe TODOS os membros que a RLS-scoped query entrega (5), não 1", async () => {
    const spy: QuerySpy = { eqCalls: [] };
    managerSession(ROSTER, spy);
    const { GET } = await import("@/app/api/v1/team/route");
    const res = await GET(new NextRequest("http://localhost/api/v1/team"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ user_id: string; role: string }> };
    expect(body.data).toHaveLength(5);
    expect(body.data.map((m) => m.role).sort()).toEqual([
      "admin",
      "agent",
      "agent",
      "manager",
      "viewer",
    ]);
  });

  it("a query é org-scoped e NÃO filtra por user_id (o roster vem só da RLS)", async () => {
    const spy: QuerySpy = { eqCalls: [] };
    managerSession(ROSTER, spy);
    const { GET } = await import("@/app/api/v1/team/route");
    await GET(new NextRequest("http://localhost/api/v1/team"));
    expect(spy.eqCalls).toContainEqual(["organization_id", ORG_ID]);
    expect(spy.eqCalls.some(([col]) => col === "user_id")).toBe(false);
  });

  it("marca o login como desconhecido quando o service role não está configurado", async () => {
    const spy: QuerySpy = { eqCalls: [] };
    managerSession(ROSTER, spy);
    const { GET } = await import("@/app/api/v1/team/route");

    const res = await GET(new NextRequest("http://localhost/api/v1/team"));
    const body = (await res.json()) as {
      data: Array<{ last_sign_in_at: string | null; last_sign_in_known: boolean }>;
    };

    expect(body.data).toHaveLength(5);
    expect(body.data.every((member) => member.last_sign_in_at === null)).toBe(true);
    expect(body.data.every((member) => member.last_sign_in_known === false)).toBe(true);
    expect(routeMocks.getUserById).not.toHaveBeenCalled();
  });

  it("distingue login ausente de login realizado quando o Auth confirma o usuário", async () => {
    const spy: QuerySpy = { eqCalls: [] };
    managerSession(ROSTER.slice(0, 2), spy);
    routeMocks.isServiceRoleConfigured.mockReturnValue(true);
    routeMocks.getUserById
      .mockResolvedValueOnce({
        data: {
          user: {
            email: "viewer@example.com",
            user_metadata: { full_name: "Viewer" },
            last_sign_in_at: null,
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          user: {
            email: "agent@example.com",
            user_metadata: {},
            last_sign_in_at: "2026-10-13T12:00:00Z",
          },
        },
      });
    const { GET } = await import("@/app/api/v1/team/route");

    const res = await GET(new NextRequest("http://localhost/api/v1/team"));
    const body = (await res.json()) as {
      data: Array<{ last_sign_in_at: string | null; last_sign_in_known: boolean }>;
    };

    expect(body.data).toEqual([
      expect.objectContaining({ last_sign_in_at: null, last_sign_in_known: true }),
      expect.objectContaining({
        last_sign_in_at: "2026-10-13T12:00:00Z",
        last_sign_in_known: true,
      }),
    ]);
  });
});
