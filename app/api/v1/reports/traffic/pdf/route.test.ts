import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getTrafficReport: vi.fn(),
  marcaDaSaida: vi.fn(),
  renderTrafficSummaryPdf: vi.fn(),
}));

vi.mock("../route", () => ({ GET: mocks.getTrafficReport }));
vi.mock("@/lib/branding/saida", () => ({ marcaDaSaida: mocks.marcaDaSaida }));
vi.mock("@/lib/windsor/traffic-summary-pdf", () => ({
  renderTrafficSummaryPdf: mocks.renderTrafficSummaryPdf,
}));

import { GET } from "./route";

const source = {
  organization_key: "11111111-1111-4111-8111-111111111111",
  window: { from: "2026-09-01", to: "2026-09-30" },
  crm: { leads_entered: 10, in_service: 7, closed_won: 3 },
  currencies: [
    {
      currency: "BRL",
      summary: { spend: 100, reach: 800, impressions: 1_000, clicks: 50 },
    },
  ],
};

describe("GET /api/v1/reports/traffic/pdf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.marcaDaSaida.mockResolvedValue({
      nome: "Marca do cliente",
      logoUrl: null,
      accent: "#506d48",
      accentFg: "#ffffff",
      origens: { nome: "organizacao", cor: "organizacao" },
    });
    mocks.renderTrafficSummaryPdf.mockResolvedValue(Buffer.from("pdf"));
  });

  it("recusa período inválido antes de consultar dados", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/v1/reports/traffic/pdf?from=2026-09-30&to=2026-01-01"),
    );

    expect(response.status).toBe(400);
    expect(mocks.getTrafficReport).not.toHaveBeenCalled();
  });

  it("propaga a autorização viewer e o tenant da rota canônica", async () => {
    const denied = Response.json(
      { error: { code: "forbidden", message: "Sem acesso." } },
      { status: 403 },
    );
    mocks.getTrafficReport.mockResolvedValue(denied);

    const response = await GET(
      new NextRequest("http://localhost/api/v1/reports/traffic/pdf?from=2026-09-01&to=2026-09-30"),
    );

    expect(response.status).toBe(403);
    expect(mocks.marcaDaSaida).not.toHaveBeenCalled();
  });

  it("gera PDF com a organização autenticada, idioma e cabeçalhos de download", async () => {
    mocks.getTrafficReport.mockResolvedValue(Response.json({ data: source }));

    const response = await GET(
      new NextRequest(
        "http://localhost/api/v1/reports/traffic/pdf?from=2026-09-01&to=2026-09-30&language=es",
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers.get("content-disposition")).toContain(
      "relatorio-resumido-2026-09-01-a-2026-09-30.pdf",
    );
    expect(mocks.marcaDaSaida).toHaveBeenCalledWith(source.organization_key);
    expect(mocks.renderTrafficSummaryPdf).toHaveBeenCalledWith({
      source,
      brand: expect.objectContaining({ nome: "Marca do cliente" }),
      language: "es",
    });
  });
});
