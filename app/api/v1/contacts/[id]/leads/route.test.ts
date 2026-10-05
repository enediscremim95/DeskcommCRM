import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { GET } from "./route";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const ORG = "11111111-1111-4111-8111-111111111111";
const OUTRA_ORG = "22222222-2222-4222-8222-222222222222";
const CONTACT = "33333333-3333-4333-8333-333333333333";

interface Registro {
  id: string;
  organization_id: string;
  contact_id?: string;
  created_at?: string;
  pipeline?: { name: string; settings: Record<string, unknown> };
  stage?: { name: string };
}

function supabaseFake() {
  const tabelas: Record<string, Registro[]> = {
    contacts: [{ id: CONTACT, organization_id: ORG }],
    crm_leads: [
      {
        id: "lead-da-org",
        organization_id: ORG,
        contact_id: CONTACT,
        created_at: "2026-10-03T12:00:00.000Z",
        pipeline: { name: "Funil A", settings: {} },
        stage: { name: "Novo" },
      },
      {
        id: "lead-da-outra-org",
        organization_id: OUTRA_ORG,
        contact_id: CONTACT,
        created_at: "2026-10-03T13:00:00.000Z",
        pipeline: { name: "Funil vazado", settings: {} },
        stage: { name: "Não pode aparecer" },
      },
    ],
  };
  const filtros: Array<{ table: string; column: string; value: unknown }> = [];

  return {
    filtros,
    client: {
      from(table: string) {
        const locais: Array<{ column: string; value: unknown }> = [];
        const filtrar = () =>
          (tabelas[table] ?? []).filter((row) =>
            locais.every(({ column, value }) => row[column as keyof Registro] === value),
          );
        const chain = {
          select: () => chain,
          eq: (column: string, value: unknown) => {
            locais.push({ column, value });
            filtros.push({ table, column, value });
            return chain;
          },
          maybeSingle: async () => ({ data: filtrar()[0] ?? null, error: null }),
          order: async () => ({ data: filtrar(), error: null }),
        };
        return chain;
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: "user-1", idioma: "pt-BR" },
    org: { orgId: ORG, role: "viewer", name: "Org" },
  } as Awaited<ReturnType<typeof requireRole>>);
});

describe("GET /api/v1/contacts/[id]/leads", () => {
  it("filtra a organização ativa e não devolve negócio de outra organização", async () => {
    const fake = supabaseFake();
    vi.mocked(createClient).mockResolvedValue(
      fake.client as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    const response = await GET(
      new NextRequest(`http://localhost/api/v1/contacts/${CONTACT}/leads`),
      { params: Promise.resolve({ id: CONTACT }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(fake.filtros).toContainEqual({
      table: "contacts",
      column: "organization_id",
      value: ORG,
    });
    expect(fake.filtros).toContainEqual({
      table: "crm_leads",
      column: "organization_id",
      value: ORG,
    });
    expect(body.data.map((lead: { id: string }) => lead.id)).toEqual(["lead-da-org"]);
  });
});
