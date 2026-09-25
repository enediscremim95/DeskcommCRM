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
  const stages = Array.from({ length: 25 }, (_, index) => ({
    id: `stage-${index}`,
    organization_id: ORGANIZATION_ID,
    pipeline_id: PIPELINE_ID,
    name: `Etapa ${index}`,
    position: index,
    is_archived: false,
  }));
  const leads = stages.flatMap((stage, stageIndex) => {
    const amount = 65 + (stageIndex < 6 ? 1 : 0);
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
  private head = false;
  private rowLimit: number | null = null;
  private single = false;
  private badRequest = false;

  constructor(
    private readonly table: string,
    private readonly dataset: ReturnType<typeof buildDataset>,
    private readonly inBatchSizes: number[],
  ) {}

  select(_columns: string, options?: { head?: boolean }) {
    this.head = options?.head ?? false;
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
  or() {
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
    return this.filters.every((filter) => {
      const current = row[filter.column];
      if (filter.kind === "eq") return current === filter.value;
      if (filter.kind === "neq") return current !== filter.value;
      return (filter.value as readonly unknown[]).includes(current);
    });
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
    const supabase = {
      auth: {
        getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }),
      },
      from: (table: string) => new Query(table, dataset, inBatchSizes),
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
    expect(Math.max(...inBatchSizes)).toBeLessThanOrEqual(200);
    expect(inBatchSizes.filter((size) => size === 200).length).toBeGreaterThan(1);
  });
});
