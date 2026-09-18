import type { AdPlatform, DashboardModel } from "./types";

export interface StoredFact {
  account_id: string;
  platform: AdPlatform;
  occurred_on: string;
  campaign_id: string | null;
  campaign_name: string;
  adset_id: string | null;
  adset_name: string;
  ad_id: string | null;
  ad_name: string;
  impressions: number | string;
  reach: number | string;
  clicks: number | string;
  link_clicks: number | string;
  spend: number | string;
  conversions: Record<string, unknown> | null;
  revenue: number | string;
  video_views: number | string;
  video_p25: number | string;
  video_p50: number | string;
  video_p75: number | string;
  video_p95: number | string;
  thumbnail_url: string | null;
  story_id: string | null;
}
export interface StoredAccount {
  account_id: string;
  account_name: string;
  platform: AdPlatform;
  currency: string;
}
interface Bucket {
  spend: number;
  conversions: number;
  revenue: number;
  impressions: number;
  reach: number;
  clicks: number;
  link_clicks: number;
  video_views: number;
  video_p25: number;
  video_p50: number;
  video_p75: number;
  video_p95: number;
}
const empty = (): Bucket => ({
  spend: 0, conversions: 0, revenue: 0, impressions: 0, reach: 0,
  clicks: 0, link_clicks: 0, video_views: 0, video_p25: 0,
  video_p50: 0, video_p75: 0, video_p95: 0,
});
const n = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
function add(target: Bucket, fact: StoredFact, fields: string[]): void {
  target.spend += n(fact.spend);
  target.conversions += fields.reduce((sum, field) => sum + n(fact.conversions?.[field]), 0);
  target.revenue += n(fact.revenue);
  target.impressions += n(fact.impressions);
  target.reach += n(fact.reach);
  target.clicks += n(fact.clicks);
  target.link_clicks += n(fact.link_clicks);
  target.video_views += n(fact.video_views);
  target.video_p25 += n(fact.video_p25);
  target.video_p50 += n(fact.video_p50);
  target.video_p75 += n(fact.video_p75);
  target.video_p95 += n(fact.video_p95);
}
function ratios(bucket: Bucket, model: DashboardModel) {
  return {
    ...bucket,
    cost_per_conversion: bucket.conversions > 0 ? bucket.spend / bucket.conversions : null,
    cpm: bucket.impressions > 0 ? (bucket.spend / bucket.impressions) * 1000 : null,
    ctr: bucket.impressions > 0 ? (bucket.link_clicks / bucket.impressions) * 100 : null,
    cpc: bucket.link_clicks > 0 ? bucket.spend / bucket.link_clicks : null,
    conversion_rate: bucket.link_clicks > 0 ? (bucket.conversions / bucket.link_clicks) * 100 : null,
    roas: model === "ecommerce" && bucket.spend > 0 ? bucket.revenue / bucket.spend : null,
    average_order_value: model === "ecommerce" && bucket.conversions > 0
      ? bucket.revenue / bucket.conversions : null,
  };
}
export function buildTrafficReport(args: {
  model: DashboardModel;
  conversionFields: string[];
  accounts: StoredAccount[];
  facts: StoredFact[];
}) {
  const accountById = new Map(args.accounts.map((account) => [account.account_id, account]));
  const rollupKey = (fact: StoredFact) => JSON.stringify([
    fact.account_id,
    fact.occurred_on,
    fact.campaign_id ?? fact.campaign_name,
    fact.adset_id ?? fact.adset_name,
  ]);
  const metaSummaryKeys = new Set(
    args.facts
      .filter((fact) => fact.platform === "meta_ads" && !fact.ad_id && !fact.ad_name)
      .map(rollupKey),
  );
  const byCurrency = new Map<string, {
    total: Bucket;
    daily: Map<string, { total: Bucket; meta: Bucket; google: Bucket }>;
    platforms: Map<AdPlatform, Bucket>;
    campaigns: Map<string, { name: string; platform: AdPlatform; total: Bucket; adsets: Map<string, { name: string; total: Bucket; ads: Map<string, { name: string; total: Bucket; thumbnail_url: string | null; story_id: string | null }> }> }>;
  }>();

  for (const fact of args.facts) {
    const account = accountById.get(fact.account_id);
    if (!account) continue;
    const currency = account.currency;
    let group = byCurrency.get(currency);
    if (!group) {
      group = { total: empty(), daily: new Map(), platforms: new Map(), campaigns: new Map() };
      byCurrency.set(currency, group);
    }
    const isMetaDetail = fact.platform === "meta_ads" && Boolean(fact.ad_id || fact.ad_name);
    const contributesToRollup = !(isMetaDetail && metaSummaryKeys.has(rollupKey(fact)));
    if (contributesToRollup) add(group.total, fact, args.conversionFields);
    let daily = group.daily.get(fact.occurred_on);
    if (!daily) {
      daily = { total: empty(), meta: empty(), google: empty() };
      group.daily.set(fact.occurred_on, daily);
    }
    if (contributesToRollup) {
      add(daily.total, fact, args.conversionFields);
      add(fact.platform === "meta_ads" ? daily.meta : daily.google, fact, args.conversionFields);
    }

    let platform = group.platforms.get(fact.platform);
    if (!platform) { platform = empty(); group.platforms.set(fact.platform, platform); }
    if (contributesToRollup) add(platform, fact, args.conversionFields);

    const campaignKey = `${fact.platform}:${(fact.campaign_id ?? fact.campaign_name) || "Sem campanha"}`;
    let campaign = group.campaigns.get(campaignKey);
    if (!campaign) {
      campaign = { name: fact.campaign_name || "Sem campanha", platform: fact.platform, total: empty(), adsets: new Map() };
      group.campaigns.set(campaignKey, campaign);
    }
    if (contributesToRollup) add(campaign.total, fact, args.conversionFields);
    const adsetName = fact.adset_name || "Sem conjunto";
    const adsetKey = fact.adset_id ?? adsetName;
    let adset = campaign.adsets.get(adsetKey);
    if (!adset) { adset = { name: adsetName, total: empty(), ads: new Map() }; campaign.adsets.set(adsetKey, adset); }
    if (contributesToRollup) add(adset.total, fact, args.conversionFields);
    if (fact.platform === "meta_ads" && !isMetaDetail) continue;
    const adName = fact.ad_name || "Sem anúncio";
    const adKey = fact.ad_id ?? adName;
    let ad = adset.ads.get(adKey);
    if (!ad) {
      ad = { name: adName, total: empty(), thumbnail_url: fact.thumbnail_url, story_id: fact.story_id };
      adset.ads.set(adKey, ad);
    }
    if (!ad.thumbnail_url && fact.thumbnail_url) ad.thumbnail_url = fact.thumbnail_url;
    if (!ad.story_id && fact.story_id) ad.story_id = fact.story_id;
    add(ad.total, fact, args.conversionFields);
  }

  return [...byCurrency.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, group]) => ({
    currency,
    summary: ratios(group.total, args.model),
    daily: [...group.daily.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({
      date, spend_meta: value.meta.spend, spend_google: value.google.spend,
      conversions: value.total.conversions, revenue: value.total.revenue,
    })),
    platforms: [...group.platforms.entries()].map(([platform, value]) => ({
      platform, ...ratios(value, args.model),
    })),
    campaigns: [...group.campaigns.values()]
      .sort((a, b) => b.total.spend - a.total.spend)
      .map((campaign) => ({
        name: campaign.name, platform: campaign.platform, ...ratios(campaign.total, args.model),
        adsets: [...campaign.adsets.values()].map((adset) => ({
          name: adset.name, ...ratios(adset.total, args.model),
          ads: [...adset.ads.values()].map((ad) => ({
            name: ad.name, ...ratios(ad.total, args.model),
            thumbnail_url: ad.thumbnail_url, story_id: ad.story_id,
          })),
        })),
      })),
  }));
}
