import { describe, expect, it } from "vitest";

import { buildTrafficSummaryGroups } from "./traffic-summary-pdf";

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
});
