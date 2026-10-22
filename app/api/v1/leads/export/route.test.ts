// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { ROLE_RANK, type Role } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

import { GET, MAX_LEADS_POR_EXPORTACAO } from "./route";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
const GESTOR = "33333333-3333-4333-8333-333333333333";

interface LinhaFalsa {
  id: string;
  organization_id: string;
  created_at: string;
  custom_fields: Record<string, unknown>;
  last_activity_at: string | null;
  lost_reason: string | null;
  lost_reason_detail: string | null;
  source: string;
  status: string;
  tags: string[];
  contacts: {
    display_name: string;
    email: string;
    name: string;
    organization_id: string;
    phone_number: string;
  } | null;
  crm_stages: { name: string; organization_id: string } | null;
}

function sessao(papel: Role) {
  vi.mocked(requireRole).mockImplementation(async (min: Role) =>
    ROLE_RANK[papel] >= ROLE_RANK[min]
      ? ({
          ok: true,
          user: { id: GESTOR, idioma: "pt-BR" },
          org: { orgId: ORG_A, name: "Organização A", role: papel },
        } as never)
      : ({
          ok: false,
          response: Response.json(
            { error: { code: "forbidden_role", message: "Permissão insuficiente." } },
            { status: 403 },
          ),
        } as never),
  );
}

function lead(diferente: Partial<LinhaFalsa> = {}): LinhaFalsa {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    organization_id: ORG_A,
    created_at: "2026-10-22T15:00:00.000Z",
    custom_fields: { interesse: "Plano anual" },
    last_activity_at: "2026-10-22T16:00:00.000Z",
    lost_reason: null,
    lost_reason_detail: null,
    source: "site",
    status: "open",
    tags: ["quente"],
    contacts: {
      display_name: "Pessoa da organização A",
      name: "Nome A",
      organization_id: ORG_A,
      phone_number: "+5511999999999",
      email: "pessoa-a@exemplo.test",
    },
    crm_stages: { name: "Novo", organization_id: ORG_A },
    ...diferente,
  };
}

function supabaseFalso(linhas: LinhaFalsa[], opcoes: { count?: number; slug?: string } = {}) {
  const filtrosPorOrg: string[] = [];
  const ranges: Array<[number, number]> = [];

  function from(tabela: string) {
    let orgId: string | null = null;
    let head = false;
    const builder = {
      select: (_campos: string, opts?: { head?: boolean }) => {
        head = opts?.head ?? false;
        return builder;
      },
      eq: (coluna: string, valor: unknown) => {
        if (coluna === "organization_id") {
          orgId = String(valor);
          filtrosPorOrg.push(orgId);
        }
        return builder;
      },
      order: () => builder,
      range: async (inicio: number, fim: number) => {
        ranges.push([inicio, fim]);
        const filtradas = linhas
          .filter((linha) => linha.organization_id === orgId)
          .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
        return { data: filtradas.slice(inicio, fim + 1), error: null };
      },
      maybeSingle: async () =>
        tabela === "organizations"
          ? { data: { slug: opcoes.slug ?? "organizacao-a" }, error: null }
          : { data: null, error: null },
      then: (resolve: (valor: { data: null; count: number | null; error: null }) => unknown) => {
        const filtradas = linhas.filter((linha) => linha.organization_id === orgId);
        return Promise.resolve(
          resolve({
            data: null,
            count: head ? (opcoes.count ?? filtradas.length) : null,
            error: null,
          }),
        );
      },
    };
    return builder;
  }

  vi.mocked(createClient).mockResolvedValue({ from } as never);
  return { filtrosPorOrg, ranges };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  sessao("manager");
});

describe("GET /api/v1/leads/export", () => {
  it.each(["agent", "viewer"] as const)("recusa o papel %s com 403", async (papel) => {
    sessao(papel);

    const response = await GET();

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(createClient).not.toHaveBeenCalled();
  });

  it.each(["manager", "admin"] as const)("permite o papel %s", async (papel) => {
    sessao(papel);
    supabaseFalso([]);

    const response = await GET();

    expect(response.status).toBe(200);
  });

  it("pagina todos os leads sem depender do limite padrão do banco", async () => {
    const linhas = Array.from({ length: 1_001 }, (_, indice) =>
      lead({
        id: `lead-${String(indice).padStart(4, "0")}`,
        created_at: new Date(Date.UTC(2026, 9, 22, 15, 0, indice)).toISOString(),
      }),
    );
    const espiao = supabaseFalso(linhas);

    const response = await GET();
    const csv = await response.text();

    expect(response.status).toBe(200);
    expect(espiao.ranges).toEqual([
      [0, 999],
      [1_000, 1_000],
    ]);
    expect(csv.split("\r\n")).toHaveLength(1_003);
  });

  it("exporta somente a organização ativa e não aceita relação de outro tenant", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-23T01:30:00.000Z"));
    const espiao = supabaseFalso(
      [
        lead(),
        lead({
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          organization_id: ORG_B,
          contacts: {
            display_name: "SENTINELA OUTRA ORGANIZAÇÃO",
            name: "SENTINELA",
            organization_id: ORG_B,
            phone_number: "+5500000000000",
            email: "sentinela@outra.test",
          },
        }),
        lead({
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          contacts: {
            display_name: "SENTINELA RELAÇÃO CRUZADA",
            name: "SENTINELA",
            organization_id: ORG_B,
            phone_number: "+5500000000001",
            email: "cruzado@outra.test",
          },
          crm_stages: { name: "ETAPA DE OUTRA ORG", organization_id: ORG_B },
        }),
      ],
      { slug: "Clínica A" },
    );

    const response = await GET();
    const csv = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="leads-clinica-a-2026-10-22.csv"',
    );
    expect(csv).toContain("Pessoa da organização A");
    expect(csv).not.toContain("SENTINELA OUTRA ORGANIZAÇÃO");
    expect(csv).not.toContain("SENTINELA RELAÇÃO CRUZADA");
    expect(csv).not.toContain("ETAPA DE OUTRA ORG");
    expect(espiao.filtrosPorOrg.length).toBeGreaterThanOrEqual(2);
    expect(new Set(espiao.filtrosPorOrg)).toEqual(new Set([ORG_A]));
  });

  it("recusa acima do teto com 413 antes de buscar páginas", async () => {
    const espiao = supabaseFalso([], { count: MAX_LEADS_POR_EXPORTACAO + 1 });

    const response = await GET();
    const corpo = (await response.json()) as { error: { message: string } };

    expect(response.status).toBe(413);
    expect(corpo.error.message).toContain("20.000");
    expect(espiao.ranges).toEqual([]);
    expect(audit).not.toHaveBeenCalled();
  });

  it("audita ator, organização e quantidade sem conteúdo pessoal", async () => {
    supabaseFalso([lead()]);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(audit).toHaveBeenCalledWith({
      action: "lead.exported",
      actorUserId: GESTOR,
      organizationId: ORG_A,
      resourceType: "crm_leads",
      requestId: expect.any(String),
      metadata: { quantidade_linhas: 1 },
    });
    const auditSerializado = JSON.stringify(vi.mocked(audit).mock.calls);
    expect(auditSerializado).not.toContain("Pessoa da organização A");
    expect(auditSerializado).not.toContain("pessoa-a@exemplo.test");
    expect(auditSerializado).not.toContain("+5511999999999");
    expect(auditSerializado).not.toContain("Plano anual");
  });
});
