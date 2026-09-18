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
});
