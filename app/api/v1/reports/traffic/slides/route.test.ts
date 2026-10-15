import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getTrafficReport: vi.fn(),
  marcaDaSaida: vi.fn(),
  fetchGoogleKeywords: vi.fn(),
  renderTrafficSummarySlides: vi.fn(),
  from: vi.fn(),
  organizationSelect: vi.fn(),
  organizationEq: vi.fn(),
  maybeSingle: vi.fn(),
  accountSelect: vi.fn(),
  accountOrganizationEq: vi.fn(),
  accountPlatformEq: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("../route", () => ({ GET: mocks.getTrafficReport }));
vi.mock("@/lib/branding/saida", () => ({ marcaDaSaida: mocks.marcaDaSaida }));
vi.mock("@/lib/logger", () => ({ logger: { warn: mocks.warn } }));
vi.mock("@/lib/windsor/google-keywords", () => ({
  fetchGoogleKeywords: mocks.fetchGoogleKeywords,
}));
vi.mock("@/lib/windsor/traffic-summary-slides", () => ({
  renderTrafficSummarySlides: mocks.renderTrafficSummarySlides,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mocks.from }),
}));

import { GET } from "./route";

const source = {
  organization_key: "11111111-1111-4111-8111-111111111111",
  organization_name: "Organização Exemplo",
  window: { from: "2026-09-01", to: "2026-09-30" },
  crm: { leads_entered: 10, in_service: 7, closed_won: 3 },
  currencies: [
    {
      currency: "BRL",
      summary: { spend: 100, reach: 800, impressions: 1_000, clicks: 50 },
    },
  ],
};
const googleAccounts = [
  {
    organization_id: source.organization_key,
    account_id: "111-222-3333",
    account_name: "Google da organização",
    platform: "google_ads",
    currency: "BRL",
  },
];
const googleKeywords = [
  {
    currency: "BRL",
    keyword: "tratamento exemplo",
    impressions: 100,
    clicks: 10,
    conversions: 2,
    ctr: 10,
    cost_per_conversion: 25,
  },
];

describe("GET /api/v1/reports/traffic/slides", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.from.mockImplementation((table: string) => {
      if (table === "organizations") return { select: mocks.organizationSelect };
      if (table === "traffic_dashboard_accounts") return { select: mocks.accountSelect };
      throw new Error(`Tabela inesperada: ${table}`);
    });
    mocks.organizationSelect.mockReturnValue({ eq: mocks.organizationEq });
    mocks.organizationEq.mockReturnValue({ maybeSingle: mocks.maybeSingle });
    mocks.accountSelect.mockReturnValue({ eq: mocks.accountOrganizationEq });
    mocks.accountOrganizationEq.mockReturnValue({ eq: mocks.accountPlatformEq });
    mocks.maybeSingle.mockResolvedValue({ data: { slug: "organizacao-exemplo" }, error: null });
    mocks.accountPlatformEq.mockResolvedValue({ data: googleAccounts, error: null });
    mocks.fetchGoogleKeywords.mockResolvedValue(googleKeywords);
    mocks.marcaDaSaida.mockResolvedValue({
      nome: "Marca do cliente",
      logoUrl: null,
      accent: "#506d48",
      accentFg: "#ffffff",
      origens: { nome: "organizacao", cor: "organizacao" },
    });
    mocks.renderTrafficSummarySlides.mockResolvedValue("<!doctype html><title>Relatório</title>");
  });

  it("recusa período inválido antes de consultar dados", async () => {
    const response = await GET(
      new NextRequest(
        "http://localhost/api/v1/reports/traffic/slides?from=2026-09-30&to=2026-01-01",
      ),
    );

    expect(response.status).toBe(400);
    expect(mocks.getTrafficReport).not.toHaveBeenCalled();
  });

  it("propaga a autorização viewer e não tenta resolver outra organização", async () => {
    mocks.getTrafficReport.mockResolvedValue(
      Response.json({ error: { code: "forbidden", message: "Sem acesso." } }, { status: 403 }),
    );

    const response = await GET(
      new NextRequest(
        "http://localhost/api/v1/reports/traffic/slides?from=2026-09-01&to=2026-09-30",
      ),
    );

    expect(response.status).toBe(403);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.marcaDaSaida).not.toHaveBeenCalled();
  });

  it("isola pelo tenant autenticado e devolve o HTML com cabeçalhos de download", async () => {
    mocks.getTrafficReport.mockResolvedValue(Response.json({ data: source }));

    const response = await GET(
      new NextRequest(
        "http://localhost/api/v1/reports/traffic/slides?from=2026-09-01&to=2026-09-30&language=es",
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers.get("content-disposition")).toContain(
      "relatorio-organizacao-exemplo-2026-09-01-a-2026-09-30.html",
    );
    expect(mocks.from).toHaveBeenCalledWith("organizations");
    expect(mocks.organizationSelect).toHaveBeenCalledWith("slug");
    expect(mocks.organizationEq).toHaveBeenCalledWith("id", source.organization_key);
    expect(mocks.accountSelect).toHaveBeenCalledWith(
      "organization_id,account_id,platform,account_name,currency",
    );
    expect(mocks.accountOrganizationEq).toHaveBeenCalledWith(
      "organization_id",
      source.organization_key,
    );
    expect(mocks.accountPlatformEq).toHaveBeenCalledWith("platform", "google_ads");
    expect(mocks.fetchGoogleKeywords).toHaveBeenCalledWith(googleAccounts, {
      from: "2026-09-01",
      to: "2026-09-30",
    });
    expect(mocks.marcaDaSaida).toHaveBeenCalledWith(source.organization_key);
    expect(mocks.renderTrafficSummarySlides).toHaveBeenCalledWith({
      source: { ...source, google_keywords: googleKeywords },
      brand: expect.objectContaining({ nome: "Marca do cliente" }),
      language: "es",
      organizationSlug: "organizacao-exemplo",
    });
    expect(await response.text()).toContain("<!doctype html>");
  });

  it("mantém o relatório com palavras vazias quando a busca Windsor falha", async () => {
    mocks.getTrafficReport.mockResolvedValue(Response.json({ data: source }));
    mocks.fetchGoogleKeywords.mockRejectedValue(new Error("timeout controlado"));

    const response = await GET(
      new NextRequest(
        "http://localhost/api/v1/reports/traffic/slides?from=2026-09-01&to=2026-09-30",
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.renderTrafficSummarySlides).toHaveBeenCalledWith(
      expect.objectContaining({ source: { ...source, google_keywords: [] } }),
    );
    expect(mocks.warn).toHaveBeenCalledWith(
      "traffic_report.google_keywords_unavailable",
      expect.objectContaining({
        organization_id: source.organization_key,
        error_code: "windsor_google_keywords_unavailable",
      }),
    );
  });
});
