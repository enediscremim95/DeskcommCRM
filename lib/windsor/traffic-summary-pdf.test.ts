import { describe, expect, it } from "vitest";

import {
  buildTrafficDeliverySections,
  buildTrafficFunnelReading,
  buildTrafficHighlights,
  buildTrafficSummaryGroups,
  trafficVariation,
} from "./traffic-summary-pdf";

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

  it("calcula a variação sem inventar percentual sobre base zero", () => {
    expect(trafficVariation(12, 10)).toEqual({ kind: "percent", percent: 20 });
    expect(trafficVariation(5, 0)).toEqual({ kind: "new", percent: null });
    expect(trafficVariation(0, 0)).toEqual({ kind: "percent", percent: 0 });
    expect(trafficVariation(5, null)).toEqual({ kind: "unavailable", percent: null });
  });

  it("leva o período anterior para os indicadores do PDF", () => {
    const [group] = buildTrafficSummaryGroups({
      window: { from: "2026-09-01", to: "2026-09-30" },
      crm: {
        leads_entered: 10,
        in_service: 5,
        closed_won: 3,
        closed_lost: 2,
        previous: { leads_entered: 8, in_service: 5, closed_won: 2, closed_lost: 1 },
      },
      currencies: [
        {
          currency: "BRL",
          summary: { spend: 100, reach: 800, impressions: 1_000, clicks: 50 },
          comparison: { spend: 120, reach: 700, impressions: 900, clicks: 40 },
        },
      ],
    });

    expect(group?.previous).toEqual({
      spend: 120,
      reach: 700,
      clicks: 40,
      leads: 8,
      costPerLead: 15,
      inService: 5,
      closedWon: 2,
      closedLost: 1,
    });
  });

  it("gera destaques factuais e prioriza o principal motivo de perda", () => {
    const source = {
      window: { from: "2026-09-01", to: "2026-09-30" },
      crm: {
        leads_entered: 12,
        in_service: 5,
        closed_won: 4,
        closed_lost: 3,
        loss_reasons: [
          { reason: "Preço", count: 2 },
          { reason: "Prazo", count: 1 },
        ],
        previous: { leads_entered: 8, in_service: 4, closed_won: 2, closed_lost: 2 },
      },
      currencies: [
        {
          currency: "BRL",
          summary: { spend: 120, reach: 1_000, impressions: 1_200, clicks: 100 },
          comparison: { spend: 100, reach: 900, impressions: 1_000, clicks: 80 },
        },
      ],
    };
    const groups = buildTrafficSummaryGroups(source);

    expect(buildTrafficHighlights(source, groups, "pt-BR")).toEqual([
      "Entrada de leads: +50%, de 8 para 12.",
      "Custo por lead melhorou 20%, para R$ 10,00.",
      "Vendas ganhas: +100%, de 2 para 4.",
      "Principal motivo de perda: Preço, 66,7% das perdas.",
    ]);
  });

  it("lê o maior estreitamento e a conversão final do funil", () => {
    const source = {
      window: { from: "2026-09-01", to: "2026-09-30" },
      crm: { leads_entered: 10, in_service: 5, closed_won: 2, closed_lost: 3 },
      currencies: [
        {
          currency: "BRL",
          summary: { spend: 100, reach: 1_000, impressions: 1_200, clicks: 100 },
        },
      ],
    };

    expect(buildTrafficFunnelReading(buildTrafficSummaryGroups(source), "pt-BR")).toEqual([
      "Maior estreitamento: visualização do anúncio para clique, com 10,0% de passagem.",
      "Conversão de lead em venda: 20,0% (2 de 10).",
    ]);
  });
});
