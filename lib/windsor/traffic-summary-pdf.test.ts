import { describe, expect, it } from "vitest";

import {
  buildTrafficAdsInTest,
  buildTrafficCampaignChampions,
  buildTrafficDeliverySections,
  buildTrafficFunnelReading,
  buildTrafficHighlights,
  buildTrafficPriorityMetricCards,
  buildTrafficSummaryGroups,
  trafficVariation,
} from "./traffic-summary-pdf";
import { adDeliverySnapshots, buildTrafficReport, type StoredFact } from "./report";

describe("resumo do relatório para PDF", () => {
  it("muda a lista de anúncios quando a mesma entrega é lida em 7 ou 15 dias", () => {
    const base: StoredFact = {
      account_id: "meta",
      platform: "meta_ads",
      occurred_on: "2026-09-08",
      campaign_id: "campaign-1",
      campaign_name: "Campanha",
      adset_id: "adset-1",
      adset_name: "Conjunto",
      ad_id: "ad-old",
      ad_name: "Anúncio antigo",
      impressions: 100,
      reach: 80,
      clicks: 5,
      link_clicks: 4,
      spend: 40,
      conversions: { actions_lead: 2 },
      revenue: 0,
      video_views: 0,
      video_p25: 0,
      video_p50: 0,
      video_p75: 0,
      video_p95: 0,
      thumbnail_url: null,
      story_id: null,
      campaign_status: "ACTIVE",
      destination_urls: ["https://cliente.test/antiga?utm_source=meta"],
    };
    const detailFacts = [
      base,
      {
        ...base,
        occurred_on: "2026-09-16",
        ad_id: "ad-new",
        ad_name: "Anúncio novo",
        spend: 20,
        conversions: { actions_lead: 1 },
        destination_urls: ["https://cliente.test/nova#form"],
      },
    ];
    const facts = detailFacts.flatMap((detail) => [
      {
        ...detail,
        ad_id: null,
        ad_name: "",
        thumbnail_url: null,
        destination_urls: [],
      },
      detail,
    ]);
    const snapshots = adDeliverySnapshots(facts);
    const reportFor = (from: string) =>
      buildTrafficReport({
        model: "leads",
        conversionFields: ["actions_lead"],
        accounts: [
          { account_id: "meta", account_name: "Meta", platform: "meta_ads", currency: "BRL" },
        ],
        facts,
        window: { from, to: "2026-09-21" },
        adDeliverySnapshots: snapshots,
      });
    const adsFor = (from: string) =>
      buildTrafficAdsInTest({
        window: { from, to: "2026-09-21" },
        crm: { leads_entered: 0, in_service: 0, closed_won: 0 },
        currencies: reportFor(from),
      });

    const report7Days = reportFor("2026-09-15");
    const report15Days = reportFor("2026-09-07");
    const ads7Days = adsFor("2026-09-15");
    const ads15Days = adsFor("2026-09-07");

    expect(ads7Days.map((ad) => ad.name)).toEqual(["Anúncio novo"]);
    expect(ads15Days.map((ad) => ad.name)).toEqual(["Anúncio antigo", "Anúncio novo"]);
    expect(ads7Days.reduce((total, ad) => total + ad.spend, 0)).toBe(report7Days[0]?.summary.spend);
    expect(ads15Days.reduce((total, ad) => total + ad.spend, 0)).toBe(
      report15Days[0]?.summary.spend,
    );
    expect(ads7Days[0]).toMatchObject({
      pages: ["cliente.test/nova"],
      movement: "new",
    });
  });

  it("marca pausa somente quando o status atual e a última entrega permitem concluir", () => {
    const ads = buildTrafficAdsInTest({
      window: { from: "2026-09-15", to: "2026-09-21" },
      crm: { leads_entered: 0, in_service: 0, closed_won: 0 },
      currencies: [
        {
          currency: "BRL",
          summary: { spend: 10, reach: 20, impressions: 30, clicks: 2 },
          campaigns: [
            {
              name: "Campanha pausada",
              platform: "meta_ads",
              campaign_status: "PAUSED",
              leads: 1,
              cost_per_lead: 10,
              conversion_rate: 50,
              adsets: [
                {
                  name: "Conjunto",
                  ads: [
                    {
                      name: "Anúncio pausado",
                      spend: 10,
                      impressions: 30,
                      leads: 1,
                      cost_per_lead: 10,
                      thumbnail_url: null,
                      destination_urls: [],
                      first_delivery_on: "2026-09-01",
                      last_delivery_on: "2026-09-18",
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    expect(ads[0]?.movement).toBe("paused");
  });

  it("elege as campanhas campeãs com a métrica atribuída pela plataforma", () => {
    const champions = buildTrafficCampaignChampions(
      [
        { name: "Alfa", leads: 41, cost_per_lead: 9, conversion_rate: 12.5 },
        { name: "Beta", leads: 52, cost_per_lead: 11, conversion_rate: 10 },
        { name: "Gama", leads: 45, cost_per_lead: 8, conversion_rate: 15 },
      ],
      "BRL",
      "pt-BR",
    );

    expect(champions).toEqual([
      { label: "Mais leads", campaignName: "Beta", value: "52 leads" },
      { label: "Menor custo por lead", campaignName: "Gama", value: "R$ 8,00" },
      { label: "Melhor conversão", campaignName: "Gama", value: "15%" },
    ]);
  });

  it("respeita os mínimos inclusivos de 20 e 40 leads", () => {
    const champions = buildTrafficCampaignChampions(
      [
        { name: "Dezenove", leads: 19, cost_per_lead: 1, conversion_rate: 99 },
        { name: "Vinte", leads: 20, cost_per_lead: 7, conversion_rate: 98 },
        { name: "Quarenta", leads: 40, cost_per_lead: 8, conversion_rate: 14 },
      ],
      "BRL",
      "pt-BR",
    );

    expect(champions[1]).toMatchObject({ campaignName: "Vinte", value: "R$ 7,00" });
    expect(champions[2]).toMatchObject({ campaignName: "Quarenta", value: "14%" });
  });

  it("desempata pelo nome e mostra o fallback em espanhol quando falta amostra", () => {
    const champions = buildTrafficCampaignChampions(
      [
        { name: "Zulu", leads: 12, cost_per_lead: 4, conversion_rate: 18 },
        { name: "Alfa", leads: 12, cost_per_lead: 4, conversion_rate: 18 },
      ],
      "BRL",
      "es",
    );

    expect(champions).toEqual([
      { label: "Más leads", campaignName: "Alfa", value: "12 leads" },
      {
        label: "Menor costo por lead",
        campaignName: "Sin datos suficientes",
        value: null,
      },
      {
        label: "Mejor conversión",
        campaignName: "Sin datos suficientes",
        value: null,
      },
    ]);
  });

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
    const sections = buildTrafficDeliverySections(
      {
        active_campaigns: [{ name: "Captação", platform: "meta_ads" }],
        invested_campaigns: [{ name: "Pesquisa", platform: "google_ads" }],
        pages: Array.from({ length: 12 }, (_, index) => `cliente.test/pagina-${index + 1}`),
      },
      "pt-BR",
    );

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

  it("usa no topo do PDF as métricas escolhidas, na mesma ordem e no período recebido", () => {
    const cards = buildTrafficPriorityMetricCards(
      {
        model: "ecommerce",
        priority_metrics: ["roas", "revenue", "crm_closed_won"],
        window: { from: "2026-09-15", to: "2026-09-21" },
        crm: {
          leads_entered: 12,
          in_service: 7,
          closed_won: 3,
          previous: { leads_entered: 8, in_service: 5, closed_won: 2 },
        },
        currencies: [
          {
            currency: "BRL",
            summary: {
              spend: 500,
              revenue: 2_000,
              roas: 4,
              reach: 1_000,
              impressions: 1_500,
              clicks: 80,
            },
            comparison: {
              spend: 400,
              revenue: 1_200,
              roas: 3,
              reach: 900,
              impressions: 1_300,
              clicks: 70,
            },
          },
        ],
      },
      0,
      "pt-BR",
    );

    expect(cards.map((card) => [card.key, card.label, card.value])).toEqual([
      ["roas", "ROAS", "4x"],
      ["revenue", "Faturamento", "R$ 2.000,00"],
      ["crm_closed_won", "Fechadas no CRM", "3"],
    ]);
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
