import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  requireSupportWrite: vi.fn(),
  createClient: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/auth/require-role", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/impersonate/support", () => ({
  requireSupportWrite: mocks.requireSupportWrite,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));

import { GET as listarCandidatos } from "@/app/api/v1/leads/duplicates/route";
import { POST as juntar } from "@/app/api/v1/leads/merge/route";
import { POST as desfazer } from "@/app/api/v1/leads/merge/[id]/undo/route";
import { GET as listarRecentes } from "@/app/api/v1/leads/merges/recent/route";

const ORG = "aaaaaaaa-0000-4000-8000-000000000001";
const USER = "aaaaaaaa-0000-4000-8000-000000000002";
const SURVIVOR = "aaaaaaaa-0000-4000-8000-000000000003";
const ABSORBED = "aaaaaaaa-0000-4000-8000-000000000004";
const LOG = "aaaaaaaa-0000-4000-8000-000000000005";

function request(body: unknown) {
  return new Request("http://local/api/v1/leads/merge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireSupportWrite.mockResolvedValue(null);
  mocks.requireRole.mockResolvedValue({
    ok: true,
    user: { id: USER },
    org: { orgId: ORG },
  });
  mocks.createClient.mockResolvedValue({ rpc: mocks.rpc, from: mocks.from });
  mocks.rpc.mockResolvedValue({ data: [], error: null });
  mocks.audit.mockResolvedValue(undefined);
});

describe("rotas de negócios duplicados", () => {
  it("lista candidatos usando somente a organização da sessão", async () => {
    const response = await listarCandidatos();

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("fn_candidatos_negocios_duplicados", {
      p_organization_id: ORG,
    });
    expect(mocks.requireRole).toHaveBeenCalledWith(
      "manager",
      expect.objectContaining({ resource: "crm_lead" }),
    );
  });

  it("junta pela sessão, audita e recusa organization_id no body", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        outcome: "merged",
        log_id: LOG,
        survivor_lead_id: SURVIVOR,
        absorbed_lead_id: ABSORBED,
      },
      error: null,
    });
    const response = await juntar(
      request({ survivor_lead_id: SURVIVOR, absorbed_lead_id: ABSORBED }) as never,
    );

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("fn_juntar_negocios", {
      p_organization_id: ORG,
      p_survivor: SURVIVOR,
      p_absorbed: ABSORBED,
    });
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "lead.duplicate_merged",
        organizationId: ORG,
        actorUserId: USER,
        resourceId: LOG,
      }),
    );

    mocks.rpc.mockClear();
    mocks.audit.mockClear();
    const forged = await juntar(
      request({
        survivor_lead_id: SURVIVOR,
        absorbed_lead_id: ABSORBED,
        organization_id: "bbbbbbbb-0000-4000-8000-000000000001",
      }) as never,
    );
    expect(forged.status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("traduz recusa transacional e não audita", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "negocio_absorvido_tem_valor" },
    });
    const response = await juntar(
      request({ survivor_lead_id: SURVIVOR, absorbed_lead_id: ABSORBED }) as never,
    );

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("state_conflict");
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("repetição idempotente não duplica o audit", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        outcome: "already_merged",
        log_id: LOG,
        survivor_lead_id: SURVIVOR,
        absorbed_lead_id: ABSORBED,
      },
      error: null,
    });
    const response = await juntar(
      request({ survivor_lead_id: SURVIVOR, absorbed_lead_id: ABSORBED }) as never,
    );

    expect(response.status).toBe(200);
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("desfaz pela organização da sessão, valida o id com Zod e audita", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        outcome: "undone",
        log_id: LOG,
        survivor_lead_id: SURVIVOR,
        absorbed_lead_id: ABSORBED,
      },
      error: null,
    });
    const response = await desfazer(new Request("http://local", { method: "POST" }), {
      params: Promise.resolve({ id: LOG }),
    });

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("fn_desfazer_juncao_de_negocios", {
      p_organization_id: ORG,
      p_log_id: LOG,
    });
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "lead.duplicate_merge_undone",
        organizationId: ORG,
        resourceId: LOG,
      }),
    );

    mocks.rpc.mockClear();
    const invalid = await desfazer(new Request("http://local", { method: "POST" }), {
      params: Promise.resolve({ id: "não-é-uuid" }),
    });
    expect(invalid.status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("lista junções recentes filtrando o tenant antes de resolver títulos", async () => {
    const filtros: Array<[string, unknown]> = [];
    mocks.from.mockImplementation((table: string) => {
      if (table === "crm_lead_merge_log") {
        const query = {
          select: () => query,
          eq: (column: string, value: unknown) => {
            filtros.push([column, value]);
            return query;
          },
          is: () => query,
          order: () => query,
          limit: () =>
            Promise.resolve({
              data: [
                {
                  id: LOG,
                  survivor_lead_id: SURVIVOR,
                  absorbed_lead_id: ABSORBED,
                  absorbed_snapshot: { title: "Card vazio" },
                  merged_by_user_id: USER,
                  merged_at: "2030-01-01T12:00:00Z",
                },
              ],
              error: null,
            }),
        };
        return query;
      }
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          filtros.push([column, value]);
          return query;
        },
        in: () => Promise.resolve({ data: [{ id: SURVIVOR, title: "Card principal" }], error: null }),
      };
      return query;
    });

    const response = await listarRecentes();
    expect(response.status).toBe(200);
    expect(filtros).toEqual([
      ["organization_id", ORG],
      ["organization_id", ORG],
    ]);
    expect((await response.json()).data[0]).toMatchObject({
      survivor_title: "Card principal",
      absorbed_title: "Card vazio",
    });
  });
});
