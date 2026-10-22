import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchWindsorCampaignReach } from "@/lib/windsor/client";

import { GET, loadPeriodReach, PATCH, WINDSOR_REACH_TIMEOUT_MS } from "./route";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/integrations/access", () => ({ clientCanViewIntegration: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/windsor/client", () => ({ fetchWindsorCampaignReach: vi.fn() }));

const ORG = "22222222-2222-4222-8222-222222222222";
const USER = "11111111-1111-4111-8111-111111111111";

function auth(platformAdmin: boolean) {
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: USER, is_platform_admin: platformAdmin, support: null },
    org: { orgId: ORG, role: "viewer", name: "Org" },
  } as never);
}

function request(metrics: string[]) {
  return new NextRequest("http://localhost/api/v1/reports/traffic", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ priority_metrics: metrics }),
  });
}

type FakeRow = Record<string, unknown>;
type FakeQueryResult = { data: FakeRow[]; error: null };

interface FactRead {
  from: number;
  to: number;
  orders: Array<{ column: string; ascending: boolean }>;
}

class FakeSelectQuery implements PromiseLike<FakeQueryResult> {
  private readonly filters: Array<(row: FakeRow) => boolean> = [];
  private readonly orders: Array<{ column: string; ascending: boolean }> = [];

  constructor(
    private readonly rows: FakeRow[],
    private readonly onRange?: (read: FactRead) => void,
  ) {}

  select(): this {
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  gte(column: string, value: unknown): this {
    this.filters.push((row) => String(row[column]) >= String(value));
    return this;
  }

  lte(column: string, value: unknown): this {
    this.filters.push((row) => String(row[column]) <= String(value));
    return this;
  }

  lt(column: string, value: unknown): this {
    this.filters.push((row) => String(row[column]) < String(value));
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): this {
    this.orders.push({ column, ascending: options?.ascending !== false });
    return this;
  }

  range(from: number, to: number): Promise<FakeQueryResult> {
    this.onRange?.({ from, to, orders: [...this.orders] });
    return Promise.resolve(this.result(from, to));
  }

  maybeSingle(): Promise<{ data: FakeRow | null; error: null }> {
    return Promise.resolve({ data: this.result().data[0] ?? null, error: null });
  }

  then<TResult1 = FakeQueryResult, TResult2 = never>(
    onfulfilled?: ((value: FakeQueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.result()).then(onfulfilled, onrejected);
  }

  private result(from?: number, to?: number): FakeQueryResult {
    const filtered = this.rows.filter((row) => this.filters.every((filter) => filter(row)));
    const ordered = [...filtered].sort((left, right) => {
      for (const order of this.orders) {
        const comparison = String(left[order.column]).localeCompare(String(right[order.column]));
        if (comparison !== 0) return order.ascending ? comparison : -comparison;
      }
      return 0;
    });
    if (from === undefined || to === undefined) return { data: ordered, error: null };
    const postgrestLimit = Math.min(to - from + 1, 1_000);
    return { data: ordered.slice(from, from + postgrestLimit), error: null };
  }
}

function trafficFact(overrides: FakeRow): FakeRow {
  return {
    organization_id: ORG,
    sync_generation: "33333333-3333-4333-8333-333333333333",
    account_id: "meta",
    platform: "meta_ads",
    occurred_on: "2026-04-17",
    campaign_id: "campaign-1",
    campaign_name: "Campanha",
    adset_id: null,
    adset_name: "",
    ad_id: null,
    ad_name: "",
    impressions: 1,
    reach: 1,
    clicks: 1,
    link_clicks: 1,
    spend: 1,
    conversions: { actions_lead: 1 },
    revenue: 0,
    video_views: 0,
    video_p25: 0,
    video_p50: 0,
    video_p75: 0,
    video_p95: 0,
    thumbnail_url: null,
    story_id: null,
    campaign_status: "ACTIVE",
    destination_urls: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSupportWrite).mockResolvedValue(null);
  vi.mocked(fetchWindsorCampaignReach).mockResolvedValue([]);
});

describe("leitura dos fatos do relatório", () => {
  it("abandona o alcance ao vivo no teto e devolve alcance indisponível", async () => {
    vi.useFakeTimers();
    const slowCampaign = vi.fn(() => new Promise<never>(() => undefined));
    const slowAccount = vi.fn(() => new Promise<never>(() => undefined));

    try {
      const pending = loadPeriodReach(
        [{ account_id: "meta", account_name: "Meta", platform: "meta_ads", currency: "BRL" }],
        { from: "2026-10-01", to: "2026-10-21" },
        {
          timeoutMs: 25,
          fetchCampaignReach: slowCampaign,
          fetchAccountReach: slowAccount,
        },
      );
      await vi.advanceTimersByTimeAsync(25);
      const result = await pending;

      expect(result.campaignReach.size).toBe(0);
      expect(result.accountReach.size).toBe(0);
      expect(slowCampaign).toHaveBeenCalledTimes(1);
      expect(slowAccount).toHaveBeenCalledTimes(1);
      expect(WINDSOR_REACH_TIMEOUT_MS).toBe(8_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("inclui os dias mais recentes quando o histórico ultrapassa 1.000 linhas", async () => {
    auth(true);
    const factReads: FactRead[] = [];
    const generation = "33333333-3333-4333-8333-333333333333";
    const facts = [
      ...Array.from({ length: 1_000 }, (_, index) =>
        trafficFact({ id: `old-${String(index).padStart(4, "0")}` }),
      ),
      trafficFact({
        id: "recent",
        occurred_on: "2026-10-13",
        spend: 4_821.39,
        conversions: { actions_lead: 1_529 },
      }),
    ];
    const tables: Record<string, FakeRow[]> = {
      traffic_dashboard_configs: [
        {
          organization_id: ORG,
          enabled: true,
          model: "leads",
          conversion_fields: ["actions_lead"],
          sync_status: "ready",
          last_sync_succeeded_at: "2026-10-13T12:00:00.000Z",
          last_sync_error: null,
          published_generation: generation,
          campaign_metric_columns: null,
          default_meta_column_preset_id: null,
          default_google_column_preset_id: null,
          priority_metric_columns: null,
        },
      ],
      traffic_dashboard_accounts: [
        {
          organization_id: ORG,
          account_id: "meta",
          account_name: "Meta",
          platform: "meta_ads",
          currency: "BRL",
        },
      ],
      traffic_dashboard_facts: facts,
      crm_stages: [],
      crm_leads: [],
      traffic_dashboard_column_presets: [],
      traffic_report_cost_thresholds: [],
    };
    vi.mocked(createAdminClient).mockReturnValue({
      from: (table: string) =>
        new FakeSelectQuery(
          tables[table] ?? [],
          table === "traffic_dashboard_facts" ? (read) => factReads.push(read) : undefined,
        ),
    } as never);

    const response = await GET(
      new NextRequest(
        "http://localhost/api/v1/reports/traffic?from=2026-09-14&to=2026-10-13&pdf_detail=1",
      ),
    );
    const body = (await response.json()) as {
      data: { currencies: Array<{ summary: { spend: number; leads: number } }> };
    };

    expect(response.status).toBe(200);
    expect(body.data.currencies[0]?.summary).toMatchObject({ spend: 4_821.39, leads: 1_529 });
    expect(factReads.some((read) => read.from === 1_000)).toBe(true);
    expect(
      factReads.every(
        (read) =>
          read.orders[0]?.column === "occurred_on" && read.orders[1]?.column === "id",
      ),
    ).toBe(true);
  });
});

describe("permissão do padrão organizacional do relatório", () => {
  it("nega ao cliente a alteração das métricas padrão da organização", async () => {
    auth(false);

    const response = await PATCH(request(["spend", "leads"]));

    expect(response.status).toBe(403);
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("admin da plataforma grava o padrão somente na organização ativa", async () => {
    auth(true);
    const filters: Array<[string, unknown]> = [];
    const chain = {
      update: vi.fn(() => chain),
      eq: vi.fn((column: string, value: unknown) => {
        filters.push([column, value]);
        return filters.length === 2 ? Promise.resolve({ error: null }) : chain;
      }),
    };
    vi.mocked(createAdminClient).mockReturnValue({ from: () => chain } as never);

    const response = await PATCH(request(["spend", "leads"]));

    expect(response.status).toBe(200);
    expect(filters).toEqual([
      ["organization_id", ORG],
      ["enabled", true],
    ]);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "traffic_dashboard.priority_metrics_updated",
        organizationId: ORG,
        actingAsPlatformAdmin: true,
      }),
    );
  });
});
