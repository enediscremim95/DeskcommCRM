import { describe, expect, it } from "vitest";
import { buildTrafficReport, type StoredFact } from "@/lib/windsor/report";
import { buildTrafficRichCrmInsights } from "@/lib/windsor/traffic-insights";
import { costTone } from "./CostThresholds";
import {
  aggregateTimeline,
  buildMonthlyRows,
  flattenCreatives,
  type RichCurrencyGroup,
} from "./RichReportSections";

const fact = (overrides: Partial<StoredFact>): StoredFact => ({
  account_id: "meta",
  platform: "meta_ads",
  occurred_on: "2026-09-10",
  campaign_id: "campaign",
  campaign_name: "Campanha",
  adset_id: "set",
  adset_name: "Conjunto",
  ad_id: "ad",
  ad_name: "Criativo dentro",
  impressions: 100,
  reach: 80,
  clicks: 50,
  link_clicks: 40,
  spend: 100,
  conversions: { actions_lead: 10 },
  revenue: 0,
  video_views: 0,
  video_p25: 0,
  video_p50: 0,
  video_p75: 0,
  video_p95: 0,
  thumbnail_url: null,
  story_id: null,
  ...overrides,
});

describe("seções ricas respeitam o período", () => {
  const [group] = buildTrafficReport({
    model: "leads",
    conversionFields: ["actions_lead"],
    window: { from: "2026-09-01", to: "2026-10-31" },
    accounts: [
      { account_id: "meta", account_name: "Meta", platform: "meta_ads", currency: "BRL" },
      { account_id: "google", account_name: "Google", platform: "google_ads", currency: "BRL" },
      { account_id: "usd", account_name: "Meta USD", platform: "meta_ads", currency: "USD" },
    ],
    facts: [
      fact({}),
      fact({
        account_id: "google",
        platform: "google_ads",
        ad_id: null,
        ad_name: "",
        adset_id: null,
        adset_name: "",
        spend: 50,
      }),
      fact({ occurred_on: "2026-10-10", ad_id: "ad-2", ad_name: "Criativo outubro", spend: 20 }),
      fact({ occurred_on: "2026-11-01", ad_id: "outside", ad_name: "Criativo fora", spend: 999 }),
      fact({ account_id: "usd", occurred_on: "2026-09-10", spend: 700 }),
    ],
  });
  const crm = buildTrafficRichCrmInsights({
    window: { from: "2026-09-01", to: "2026-10-31" },
    stages: [],
    leads: [
      { status: "open", stage_id: "", lost_reason: null, created_at: "2026-09-03" },
      {
        status: "won",
        stage_id: "",
        lost_reason: null,
        created_at: "2026-10-03",
        closed_at: "2026-10-20",
      },
      {
        status: "won",
        stage_id: "",
        lost_reason: null,
        created_at: "2026-11-03",
        closed_at: "2026-11-20",
      },
    ],
  });

  it("mantém Meta e Google na mesma moeda sem incorporar outra moeda", () => {
    expect(group?.currency).toBe("BRL");
    expect(group?.summary.spend).toBe(170);
    expect(group?.platforms.map((row) => row.platform).sort()).toEqual(["google_ads", "meta_ads"]);
  });

  it("ranking de criativos ignora anúncio fora do período", () => {
    expect(flattenCreatives(group as RichCurrencyGroup).map((row) => row.name)).toEqual([
      "Criativo dentro",
      "Criativo outubro",
    ]);
  });

  it("mês a mês usa somente fatos e leads do período", () => {
    expect(
      buildMonthlyRows(group as RichCurrencyGroup, crm).map((row) => [row.month, row.crm_leads]),
    ).toEqual([
      ["2026-09", 1],
      ["2026-10", 1],
    ]);
  });

  it("granularidade agrega apenas os pontos recebidos da janela", () => {
    expect(
      aggregateTimeline((group as RichCurrencyGroup).daily, "monthly").map((row) => row.date),
    ).toEqual(["2026-09", "2026-10"]);
  });

  it("semáforo fica neutro sem limite e aplica os três estados configurados", () => {
    const threshold = { platform: "meta_ads" as const, good_until: 10, acceptable_until: 20 };
    expect(costTone(5, undefined)).toBe("none");
    expect(costTone(5, threshold)).toBe("good");
    expect(costTone(15, threshold)).toBe("warning");
    expect(costTone(25, threshold)).toBe("high");
  });
});
