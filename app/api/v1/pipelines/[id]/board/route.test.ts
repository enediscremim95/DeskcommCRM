import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { loadAuthUser } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/auth/server", () => ({ loadAuthUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const PIPELINE_ID = "22222222-2222-4222-8222-222222222222";

interface QueryResult {
  data: unknown;
  error: { message: string } | null;
  count: number | null;
}

interface Filter {
  kind: "eq" | "neq" | "in";
  column: string;
  value: unknown;
}

function buildDataset() {
  const stages = Array.from({ length: 26 }, (_, index) => ({
    id: `stage-${index}`,
    organization_id: ORGANIZATION_ID,
    pipeline_id: PIPELINE_ID,
    name: `Etapa ${index}`,
    position: index,
    is_archived: false,
  }));
  const leads = stages.flatMap((stage, stageIndex) => {
    const amount = stageIndex === 25 ? 0 : 65 + (stageIndex < 6 ? 1 : 0);
    return Array.from({ length: amount }, (_, index) => ({
      id: `lead-${stageIndex}-${String(index).padStart(3, "0")}`,
      organization_id: ORGANIZATION_ID,
      pipeline_id: PIPELINE_ID,
      stage_id: stage.id,
      title: `Negócio ${stageIndex}-${index}`,
      status: "open",
      position_in_stage: (index + 1) * 1_000,
      owner_kind: null,
      owner_agent_id: null,
      contact_id: null,
      updated_at: "2026-09-25T00:00:00.000Z",
    }));
  });
  return { stages, leads };
}

class Query implements PromiseLike<QueryResult> {
  private filters: Filter[] = [];
  private cursor: { position: number; id: string } | null = null;
  private head = false;
  private rowLimit: number | null = null;
  private single = false;
  private badRequest = false;

  constructor(
    private readonly table: string,
    private readonly dataset: ReturnType<typeof buildDataset>,
    private readonly inBatchSizes: number[],
    private readonly exactCountQueries: string[],
  ) {}

  select(_columns: string, options?: { head?: boolean }) {
    this.head = options?.head ?? false;
    if (this.head) this.exactCountQueries.push(this.table);
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push({ kind: "eq", column, value });
    return this;
  }
  neq(column: string, value: unknown) {
    this.filters.push({ kind: "neq", column, value });
    return this;
  }
  in(column: string, values: readonly unknown[]) {
    this.inBatchSizes.push(values.length);
    if (values.length > 200) this.badRequest = true;
    this.filters.push({ kind: "in", column, value: values });
    return this;
  }
  not() {
    return this;
  }
  order() {
    return this;
  }
  or(expression: string) {
    const match = expression.match(
      /^position_in_stage\.gt\.([^,]+),and\(position_in_stage\.eq\.([^,]+),id\.gt\.(.+)\)$/,
    );
    if (match) {
      this.cursor = { position: Number(match[1]), id: match[3]! };
    }
    return this;
  }
  limit(value: number) {
    this.rowLimit = value;
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }

  private matches(row: Record<string, unknown>): boolean {
    const matchesFilters = this.filters.every((filter) => {
      const current = row[filter.column];
      if (filter.kind === "eq") return current === filter.value;
      if (filter.kind === "neq") return current !== filter.value;
      return (filter.value as readonly unknown[]).includes(current);
    });
    if (!matchesFilters || !this.cursor) return matchesFilters;

    const position = Number(row.position_in_stage);
    return (
      position > this.cursor.position ||
      (position === this.cursor.position && String(row.id) > this.cursor.id)
    );
  }

  private execute(): QueryResult {
    if (this.badRequest) return { data: null, error: { message: "Bad Request" }, count: null };

    const pipeline = {
      id: PIPELINE_ID,
      organization_id: ORGANIZATION_ID,
      name: "Funil de vendas",
      slug: "funil-de-vendas",
      description: null,
      is_default: true,
      is_archived: false,
      position: 0,
      vocabulary: {},
      settings: {},
    };
    let rows: Record<string, unknown>[];
    if (this.table === "crm_pipelines") rows = [pipeline];
    else if (this.table === "crm_stages") rows = this.dataset.stages;
    else if (this.table === "crm_leads") rows = this.dataset.leads;
    else rows = [];

    rows = rows.filter((row) => this.matches(row));
    rows.sort(
      (a, b) =>
        Number(a.position_in_stage ?? a.position ?? 0) -
          Number(b.position_in_stage ?? b.position ?? 0) ||
        String(a.id).localeCompare(String(b.id)),
    );
    const count = rows.length;
    if (this.head) return { data: null, error: null, count };
    if (this.rowLimit !== null) rows = rows.slice(0, this.rowLimit);
    return { data: this.single ? (rows[0] ?? null) : rows, error: null, count: null };
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }
}

describe("GET /api/v1/pipelines/[id]/board com muitos negócios", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadAuthUser).mockResolvedValue({ idioma: "pt-BR" } as never);
  });

  it("carrega 1.631 negócios por páginas de etapa sem montar filtro in gigante", async () => {
    const dataset = buildDataset();
    const inBatchSizes: number[] = [];
    const exactCountQueries: string[] = [];
    const rpc = vi.fn(async () => ({
      data: dataset.stages
        .map((stage) => ({
          stage_id: stage.id,
          total: dataset.leads.filter(
            (lead) => lead.stage_id === stage.id && lead.status !== "archived",
          ).length,
        }))
        .filter((row) => row.total > 0),
      error: null,
    }));
    const supabase = {
      auth: {
        getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }),
      },
      from: (table: string) => new Query(table, dataset, inBatchSizes, exactCountQueries),
      rpc,
    };
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const { GET } = await import("@/app/api/v1/pipelines/[id]/board/route");
    const response = await GET(
      new NextRequest(`http://localhost/api/v1/pipelines/${PIPELINE_ID}/board`),
      { params: Promise.resolve({ id: PIPELINE_ID }) },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { leads: unknown[]; stage_pages: Record<string, { total: number }> };
    };
    expect(body.data.leads).toHaveLength(25 * 50);
    expect(Object.values(body.data.stage_pages).reduce((sum, page) => sum + page.total, 0)).toBe(
      1_631,
    );
    expect(body.data.stage_pages["stage-25"]?.total).toBe(0);
    expect(Math.max(...inBatchSizes)).toBeLessThanOrEqual(200);
    expect(inBatchSizes.filter((size) => size === 200).length).toBeGreaterThan(1);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("fn_contagem_por_etapa", {
      p_organization_id: ORGANIZATION_ID,
      p_pipeline_id: PIPELINE_ID,
    });
    expect(exactCountQueries).toEqual([]);
  });

  it("carregar mais não pula nem repete cards quando um lead novo entra antes do cursor", async () => {
    const dataset = buildDataset();
    const inBatchSizes: number[] = [];
    const exactCountQueries: string[] = [];
    const rpc = vi.fn(async () => ({
      data: dataset.stages
        .map((stage) => ({
          stage_id: stage.id,
          total: dataset.leads.filter(
            (lead) => lead.stage_id === stage.id && lead.status !== "archived",
          ).length,
        }))
        .filter((row) => row.total > 0),
      error: null,
    }));
    const supabase = {
      auth: {
        getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }),
      },
      from: (table: string) => new Query(table, dataset, inBatchSizes, exactCountQueries),
      rpc,
    };
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const { GET } = await import("@/app/api/v1/pipelines/[id]/board/route");
    const firstResponse = await GET(
      new NextRequest(`http://localhost/api/v1/pipelines/${PIPELINE_ID}/board?stage_id=stage-0`),
      { params: Promise.resolve({ id: PIPELINE_ID }) },
    );
    const firstBody = (await firstResponse.json()) as {
      data: { leads: Array<{ id: string }>; page: { cursor: string } };
    };

    dataset.leads.push({
      id: "lead-novo-no-topo",
      organization_id: ORGANIZATION_ID,
      pipeline_id: PIPELINE_ID,
      stage_id: "stage-0",
      title: "Chegou agora",
      status: "open",
      position_in_stage: 0,
      owner_kind: null,
      owner_agent_id: null,
      contact_id: null,
      updated_at: "2026-10-01T00:00:00.000Z",
    });

    const query = new URLSearchParams({
      stage_id: "stage-0",
      cursor: firstBody.data.page.cursor,
    });
    const secondResponse = await GET(
      new NextRequest(`http://localhost/api/v1/pipelines/${PIPELINE_ID}/board?${query}`),
      { params: Promise.resolve({ id: PIPELINE_ID }) },
    );
    const secondBody = (await secondResponse.json()) as {
      data: { leads: Array<{ id: string }> };
    };

    const firstIds = firstBody.data.leads.map((lead) => lead.id);
    const secondIds = secondBody.data.leads.map((lead) => lead.id);
    const loadedIds = [...firstIds, ...secondIds];

    expect(firstIds).toHaveLength(50);
    expect(secondIds).toHaveLength(16);
    expect(new Set(loadedIds).size).toBe(66);
    expect(loadedIds).toEqual(
      Array.from({ length: 66 }, (_, index) => `lead-0-${String(index).padStart(3, "0")}`),
    );
    expect(secondIds).not.toContain("lead-novo-no-topo");
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(exactCountQueries).toEqual([]);
  });
});
