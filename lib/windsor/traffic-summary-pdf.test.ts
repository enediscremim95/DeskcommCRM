import { describe, expect, it } from "vitest";

import { buildTrafficDeliverySections, buildTrafficSummaryGroups } from "./traffic-summary-pdf";

describe("resumo do relatório para PDF", () => {
  it("repete todos os leads do CRM por moeda e nunca soma investimentos distintos", () => {
    const groups = buildTrafficSummaryGroups({
      window: { from: "2026-09-01", to: "2026-09-30" },
      crm: { leads_entered: 10, in_service: 7, closed_won: 3 },
      currencies: [
        {
          currency: "BRL",
          summary: { spend: 100, reach: 800, impressions: 1_000, clicks: 50 },
        },
        {
          currency: "USD",
          summary: { spend: 250, reach: 900, impressions: 1_200, clicks: 60 },
        },
      ],
    });

    expect(groups).toHaveLength(2);
    expect(
      groups.map((group) => [group.currency, group.spend, group.leads, group.costPerLead]),
    ).toEqual([
      ["BRL", 100, 10, 10],
      ["USD", 250, 10, 25],
    ]);
  });

  it("não chama zero de alcance e usa impressões somente no desenho do funil", () => {
    const [group] = buildTrafficSummaryGroups({
      window: { from: "2026-09-01", to: "2026-09-30" },
      crm: { leads_entered: 0, in_service: 0, closed_won: 0 },
      currencies: [
        {
          currency: "BRL",
          summary: { spend: 100, reach: null, impressions: 1_000, clicks: 50 },
        },
      ],
    });

    expect(group).toMatchObject({
      reach: null,
      mediaKind: "impressions",
      mediaValue: 1_000,
      costPerLead: null,
    });
  });

  it("mantém os dados do CRM quando ainda não há mídia no período", () => {
    const [group] = buildTrafficSummaryGroups({
      window: { from: "2026-09-01", to: "2026-09-30" },
      crm: { leads_entered: 4, in_service: 3, closed_won: 1 },
      currencies: [],
    });

    expect(group).toMatchObject({
      currency: null,
      spend: null,
      leads: 4,
      inService: 3,
      closedWon: 1,
    });
  });

  it("mostra as duas réguas separadas, URLs limpas e limita listas longas", () => {
    const sections = buildTrafficDeliverySections({
      active_campaigns: [{ name: "Captação", platform: "meta_ads" }],
      invested_campaigns: [{ name: "Pesquisa", platform: "google_ads" }],
      pages: Array.from({ length: 12 }, (_, index) => `cliente.test/pagina-${index + 1}`),
    }, "pt-BR");

    expect(sections[0]).toEqual({
      title: "Hoje: 1 campanha ativa",
      items: ["Captação · Meta"],
    });
    expect(sections[1]).toEqual({
      title: "1 campanha com investimento no período",
      items: ["Pesquisa · Google"],
    });
    expect(sections[2]?.title).toBe("12 páginas em teste");
    expect(sections[2]?.items).toHaveLength(11);
    expect(sections[2]?.items.at(-1)).toBe("e mais 2");
  });
});
