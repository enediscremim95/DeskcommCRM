import { describe, expect, it } from "vitest";
import { buildTrafficReport, type StoredFact } from "./report";

const fact = (overrides: Partial<StoredFact>): StoredFact => ({
  account_id: "meta", platform: "meta_ads", occurred_on: "2026-09-18",
  campaign_id: "campaign-1", campaign_name: "Campanha",
  adset_id: "adset-1", adset_name: "Conjunto", ad_id: "ad-1", ad_name: "Anúncio",
  impressions: 1000, reach: 800, clicks: 50, link_clicks: 40, spend: 100,
  conversions: { actions_lead: 4 }, revenue: 0, video_views: 0,
  video_p25: 0, video_p50: 0, video_p75: 0, video_p95: 0,
  thumbnail_url: null, story_id: null,
  ...overrides,
});

describe("relatório de tráfego", () => {
  it("mantém moedas separadas e agrega por plataforma", () => {
    const result = buildTrafficReport({
      model: "leads", conversionFields: ["actions_lead"],
      accounts: [
        { account_id: "meta", account_name: "Meta", platform: "meta_ads", currency: "BRL" },
        { account_id: "google", account_name: "Google", platform: "google_ads", currency: "USD" },
      ],
      facts: [fact({}), fact({ account_id: "google", platform: "google_ads", spend: 20 })],
    });
    expect(result.map((item) => item.currency)).toEqual(["BRL", "USD"]);
    expect(result[0]?.summary.spend).toBe(100);
    expect(result[1]?.summary.spend).toBe(20);
  });

  it("soma somente as conversões configuradas e calcula e-commerce", () => {
    const [group] = buildTrafficReport({
      model: "ecommerce", conversionFields: ["actions_purchase"],
      accounts: [{ account_id: "meta", account_name: "Meta", platform: "meta_ads", currency: "BRL" }],
      facts: [fact({ conversions: { actions_lead: 99, actions_purchase: 2 }, revenue: 500 })],
    });
    expect(group).toBeDefined();
    expect(group!.summary.conversions).toBe(2);
    expect(group!.summary.roas).toBe(5);
    expect(group!.summary.average_order_value).toBe(250);
    expect(group!.campaigns[0]!.adsets[0]!.ads[0]!.name).toBe("Anúncio");
  });

  it("não funde campanhas diferentes que têm o mesmo nome", () => {
    const [group] = buildTrafficReport({
      model: "leads", conversionFields: ["actions_lead"],
      accounts: [{ account_id: "meta", account_name: "Meta", platform: "meta_ads", currency: "BRL" }],
      facts: [fact({ campaign_id: "campaign-1" }), fact({ campaign_id: "campaign-2" })],
    });
    expect(group?.campaigns).toHaveLength(2);
  });

  it("usa o nível de conjunto nos KPIs sem duplicar os anúncios do drill", () => {
    const summary = fact({ ad_id: null, ad_name: "", spend: 101.11, impressions: 1010 });
    const detail = fact({ spend: 100, impressions: 1000 });
    const [group] = buildTrafficReport({
      model: "leads", conversionFields: ["actions_lead"],
      accounts: [{ account_id: "meta", account_name: "Meta", platform: "meta_ads", currency: "BRL" }],
      facts: [summary, detail],
    });

    expect(group?.summary.spend).toBe(101.11);
    expect(group?.campaigns[0]?.spend).toBe(101.11);
    expect(group?.campaigns[0]?.adsets[0]?.spend).toBe(101.11);
    expect(group?.campaigns[0]?.adsets[0]?.ads).toHaveLength(1);
    expect(group?.campaigns[0]?.adsets[0]?.ads[0]?.spend).toBe(100);
  });

  it("não soma orçamento por dia e não publica alcance diário como alcance do período", () => {
    const [group] = buildTrafficReport({
      model: "ecommerce", conversionFields: ["actions_purchase"],
      accounts: [{ account_id: "meta", account_name: "Meta", platform: "meta_ads", currency: "BRL" }],
      facts: [
        fact({
          occurred_on: "2026-09-17", reach: 800,
          conversions: {
            actions_purchase: 1, actions_landing_page_view: 10, actions_add_to_cart: 4,
            actions_initiate_checkout: 2, campaign_daily_budget: 12500,
          },
        }),
        fact({
          occurred_on: "2026-09-18", reach: 900,
          conversions: {
            actions_purchase: 1, actions_landing_page_view: 15, actions_add_to_cart: 6,
            actions_initiate_checkout: 3, campaign_daily_budget: 12500,
          },
        }),
      ],
    });
    const campaign = group?.campaigns[0];
    expect(campaign?.budget).toBe(125);
    expect(campaign?.budget_type).toBe("daily");
    expect(campaign?.reach).toBeNull();
    expect(campaign?.landing_page_views).toBe(25);
    expect(campaign?.add_to_cart).toBe(10);
    expect(campaign?.initiate_checkout).toBe(5);
    expect(campaign?.purchases).toBe(2);
    expect(campaign?.cost_per_add_to_cart).toBe(20);
  });

  it("usa alcance agregado do período na campanha", () => {
    const [group] = buildTrafficReport({
      model: "leads",
      conversionFields: ["actions_lead"],
      accounts: [{ account_id: "meta", account_name: "Meta", platform: "meta_ads", currency: "BRL" }],
      facts: [fact({ campaign_id: "camp-1", reach: 900 })],
      campaignReach: new Map([["meta_ads:camp-1", 750]]),
    });
    expect(group?.campaigns[0]?.reach).toBe(750);
    expect(group?.summary.reach).toBeNull();
  });

  it("publica o status mais recente de cada campanha", () => {
    const [group] = buildTrafficReport({
      model: "leads", conversionFields: ["actions_lead"],
      accounts: [{ account_id: "meta", account_name: "Meta", platform: "meta_ads", currency: "BRL" }],
      facts: [
        fact({ occurred_on: "2026-09-17", campaign_status: "ACTIVE" }),
        fact({ occurred_on: "2026-09-18", campaign_status: "PAUSED" }),
      ],
    });
    expect(group?.campaigns[0]?.campaign_status).toBe("PAUSED");
  });

  it("restringe campanha, detalhes, total e retenção à janela escolhida sem duplicar anúncios", () => {
    const dates = Array.from({ length: 22 }, (_, index) => {
      const date = new Date("2026-08-27T00:00:00Z");
      date.setUTCDate(date.getUTCDate() + index);
      return date.toISOString().slice(0, 10);
    });
    const dailySpend = dates.map((date, index) => {
      if (date >= "2026-09-15") return 6.63;
      return index === 18 ? 31.02 : 30.86;
    });
    const campaignFacts = dates.flatMap((occurred_on, index) => {
      const spend = dailySpend[index]!;
      const summary = fact({
        occurred_on,
        adset_id: null,
        adset_name: "",
        ad_id: null,
        ad_name: "",
        spend,
        impressions: 100,
        video_views: 10,
        video_p25: 8,
        video_p50: 6,
        video_p75: 4,
        video_p95: 2,
      });
      const firstAd = fact({
        occurred_on,
        ad_id: "ad-1",
        ad_name: "Anúncio 1",
        spend: Number((spend / 2).toFixed(2)),
        impressions: 40,
        video_views: 4,
        video_p25: 3,
        video_p50: 2,
        video_p75: 1,
        video_p95: 1,
      });
      const secondAd = fact({
        occurred_on,
        ad_id: "ad-2",
        ad_name: "Anúncio 2",
        spend: Number((spend - Number(firstAd.spend)).toFixed(2)),
        impressions: 60,
        video_views: 6,
        video_p25: 5,
        video_p50: 4,
        video_p75: 3,
        video_p95: 1,
      });
      return [summary, firstAd, secondAd];
    });
    const outsideCampaign = fact({
      occurred_on: "2026-09-10",
      campaign_id: "campaign-outside",
      campaign_name: "Campanha fora do período",
      spend: 599.65,
    });
    const noDeliveryCampaign = fact({
      occurred_on: "2026-09-16",
      campaign_id: "campaign-zero",
      campaign_name: "Campanha sem entrega",
      spend: 0,
      impressions: 0,
      reach: 0,
      clicks: 0,
      link_clicks: 0,
      conversions: {},
    });

    const [group] = buildTrafficReport({
      model: "leads",
      conversionFields: ["actions_lead"],
      accounts: [
        { account_id: "meta", account_name: "Meta", platform: "meta_ads", currency: "BRL" },
      ],
      facts: [...campaignFacts, outsideCampaign, noDeliveryCampaign],
      window: { from: "2026-09-15", to: "2026-09-21" },
    });

    expect(group?.summary.spend).toBeCloseTo(19.89, 2);
    expect(group?.summary.impressions).toBe(300);
    expect(group?.summary.video_views).toBe(30);
    expect(group?.daily.map((day) => day.date)).toEqual([
      "2026-09-15",
      "2026-09-16",
      "2026-09-17",
    ]);
    expect(group?.campaigns.map((campaign) => campaign.name)).toEqual(["Campanha"]);
    expect(group?.campaigns[0]?.spend).toBeCloseTo(19.89, 2);
    expect(group?.campaigns[0]?.adsets[0]?.spend).toBeCloseTo(19.89, 2);
    expect(group?.campaigns[0]?.adsets[0]?.ads).toHaveLength(2);
    expect(
      group?.campaigns[0]?.adsets[0]?.ads.reduce((sum, ad) => sum + ad.spend, 0),
    ).toBeCloseTo(19.89, 2);
  });
});
