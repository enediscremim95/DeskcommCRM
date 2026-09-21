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
  campaign_status?: string | null;
  destination_urls?: string[] | null;
}
export interface StoredAccount {
  account_id: string;
  account_name: string;
  platform: AdPlatform;
  currency: string;
}

export function campaignReportKey(
  platform: AdPlatform,
  campaignId: string | null,
  campaignName: string,
): string {
  return `${platform}:${campaignId ?? (campaignName || "Sem campanha")}`;
}
interface Bucket {
  spend: number;
  conversions: number;
  landing_page_views: number;
  add_to_cart: number;
  initiate_checkout: number;
  purchases: number;
  messaging_conversations: number;
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
  landing_page_views_available: boolean;
  add_to_cart_available: boolean;
  initiate_checkout_available: boolean;
  purchases_available: boolean;
  messaging_conversations_available: boolean;
}
const empty = (): Bucket => ({
  spend: 0,
  conversions: 0,
  revenue: 0,
  impressions: 0,
  reach: 0,
  landing_page_views: 0,
  add_to_cart: 0,
  initiate_checkout: 0,
  purchases: 0,
  messaging_conversations: 0,
  clicks: 0,
  link_clicks: 0,
  video_views: 0,
  video_p25: 0,
  video_p50: 0,
  video_p75: 0,
  video_p95: 0,
  landing_page_views_available: false,
  add_to_cart_available: false,
  initiate_checkout_available: false,
  purchases_available: false,
  messaging_conversations_available: false,
});
const n = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
interface CampaignBudget {
  campaign_daily: number;
  campaign_lifetime: number;
  adsets_daily: Map<string, number>;
  adsets_lifetime: Map<string, number>;
}
const budgetsByBucket = new WeakMap<Bucket, Map<string, CampaignBudget>>();
function action(fact: StoredFact, field: string): number {
  return n(fact.conversions?.[field]);
}
function hasAction(fact: StoredFact, field: string): boolean {
  return fact.conversions != null && Object.prototype.hasOwnProperty.call(fact.conversions, field);
}
function rememberBudget(target: Bucket, fact: StoredFact): void {
  const campaignKey = fact.campaign_id ?? fact.campaign_name;
  if (!campaignKey) return;
  let campaigns = budgetsByBucket.get(target);
  if (!campaigns) {
    campaigns = new Map();
    budgetsByBucket.set(target, campaigns);
  }
  let budget = campaigns.get(campaignKey);
  if (!budget) {
    budget = {
      campaign_daily: 0,
      campaign_lifetime: 0,
      adsets_daily: new Map(),
      adsets_lifetime: new Map(),
    };
    campaigns.set(campaignKey, budget);
  }
  budget.campaign_daily = Math.max(budget.campaign_daily, action(fact, "campaign_daily_budget"));
  budget.campaign_lifetime = Math.max(
    budget.campaign_lifetime,
    action(fact, "campaign_lifetime_budget"),
  );
  const adsetKey = fact.adset_id ?? fact.adset_name;
  if (!adsetKey) return;
  budget.adsets_daily.set(
    adsetKey,
    Math.max(budget.adsets_daily.get(adsetKey) ?? 0, action(fact, "adset_daily_budget")),
  );
  budget.adsets_lifetime.set(
    adsetKey,
    Math.max(budget.adsets_lifetime.get(adsetKey) ?? 0, action(fact, "adset_lifetime_budget")),
  );
}
function budgetOf(bucket: Bucket): {
  budget: number | null;
  budget_type: "daily" | "lifetime" | null;
} {
  const campaigns = budgetsByBucket.get(bucket);
  if (!campaigns?.size) return { budget: null, budget_type: null };
  const resolved = [...campaigns.values()]
    .map((item) => {
      const daily =
        item.campaign_daily ||
        [...item.adsets_daily.values()].reduce((sum, value) => sum + value, 0);
      if (daily > 0) return { value: daily / 100, type: "daily" as const };
      const lifetime =
        item.campaign_lifetime ||
        [...item.adsets_lifetime.values()].reduce((sum, value) => sum + value, 0);
      return lifetime > 0 ? { value: lifetime / 100, type: "lifetime" as const } : null;
    })
    .filter((item): item is { value: number; type: "daily" | "lifetime" } => item !== null);
  if (!resolved.length || new Set(resolved.map((item) => item.type)).size !== 1) {
    return { budget: null, budget_type: null };
  }
  return {
    budget: resolved.reduce((sum, item) => sum + item.value, 0),
    budget_type: resolved[0]!.type,
  };
}
function add(target: Bucket, fact: StoredFact, fields: string[]): void {
  target.spend += n(fact.spend);
  target.conversions += fields.reduce((sum, field) => sum + n(fact.conversions?.[field]), 0);
  target.landing_page_views += action(fact, "actions_landing_page_view");
  target.add_to_cart += action(fact, "actions_add_to_cart");
  target.initiate_checkout += action(fact, "actions_initiate_checkout");
  target.purchases += action(fact, "actions_purchase");
  target.messaging_conversations += action(
    fact,
    "actions_onsite_conversion_messaging_conversation_started_7d",
  );
  target.landing_page_views_available ||= hasAction(fact, "actions_landing_page_view");
  target.add_to_cart_available ||= hasAction(fact, "actions_add_to_cart");
  target.initiate_checkout_available ||= hasAction(fact, "actions_initiate_checkout");
  target.purchases_available ||= hasAction(fact, "actions_purchase");
  target.messaging_conversations_available ||= hasAction(
    fact,
    "actions_onsite_conversion_messaging_conversation_started_7d",
  );
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
  rememberBudget(target, fact);
}
function hasDelivery(bucket: Bucket): boolean {
  return [
    bucket.spend,
    bucket.conversions,
    bucket.revenue,
    bucket.impressions,
    bucket.reach,
    bucket.clicks,
    bucket.link_clicks,
    bucket.video_views,
    bucket.video_p25,
    bucket.video_p50,
    bucket.video_p75,
    bucket.video_p95,
    bucket.landing_page_views,
    bucket.add_to_cart,
    bucket.initiate_checkout,
    bucket.purchases,
    bucket.messaging_conversations,
  ].some((value) => value > 0);
}
function ratios(bucket: Bucket, model: DashboardModel, periodReach: number | null = null) {
  const budget = budgetOf(bucket);
  return {
    ...bucket,
    ...budget,
    reach: periodReach,
    frequency: periodReach != null && periodReach > 0 ? bucket.impressions / periodReach : null,
    leads: bucket.conversions,
    cost_per_conversion: bucket.conversions > 0 ? bucket.spend / bucket.conversions : null,
    cost_per_lead: bucket.conversions > 0 ? bucket.spend / bucket.conversions : null,
    cost_per_landing_page_view:
      bucket.landing_page_views > 0 ? bucket.spend / bucket.landing_page_views : null,
    cost_per_add_to_cart: bucket.add_to_cart > 0 ? bucket.spend / bucket.add_to_cart : null,
    cost_per_initiate_checkout:
      bucket.initiate_checkout > 0 ? bucket.spend / bucket.initiate_checkout : null,
    cost_per_purchase: bucket.purchases > 0 ? bucket.spend / bucket.purchases : null,
    cost_per_messaging_conversation:
      bucket.messaging_conversations > 0 ? bucket.spend / bucket.messaging_conversations : null,
    cpm: bucket.impressions > 0 ? (bucket.spend / bucket.impressions) * 1000 : null,
    ctr: bucket.impressions > 0 ? (bucket.link_clicks / bucket.impressions) * 100 : null,
    cpc: bucket.link_clicks > 0 ? bucket.spend / bucket.link_clicks : null,
    conversion_rate:
      bucket.link_clicks > 0 ? (bucket.conversions / bucket.link_clicks) * 100 : null,
    roas: model === "ecommerce" && bucket.spend > 0 ? bucket.revenue / bucket.spend : null,
    average_order_value:
      model === "ecommerce" && bucket.conversions > 0 ? bucket.revenue / bucket.conversions : null,
  };
}
export function buildTrafficReport(args: {
  model: DashboardModel;
  conversionFields: string[];
  accounts: StoredAccount[];
  facts: StoredFact[];
  window?: { from: string; to: string };
  campaignReach?: ReadonlyMap<string, number>;
  accountReach?: ReadonlyMap<string, number>;
}) {
  // A consulta já filtra a janela no banco. Este segundo limite mantém o
  // agregador fiel ao contrato mesmo se uma fonte auxiliar entregar snapshot
  // histórico ou se uma chamada futura deixar o filtro de fora.
  const selectedWindow = args.window;
  const facts = selectedWindow
    ? args.facts.filter(
        (fact) =>
          fact.occurred_on >= selectedWindow.from && fact.occurred_on <= selectedWindow.to,
      )
    : args.facts;
  const accountById = new Map(args.accounts.map((account) => [account.account_id, account]));
  const campaignRollupKey = (fact: StoredFact) =>
    JSON.stringify([
      fact.account_id,
      fact.occurred_on,
      fact.campaign_id ?? fact.campaign_name,
    ]);
  const adsetRollupKey = (fact: StoredFact) =>
    JSON.stringify([
      fact.account_id,
      fact.occurred_on,
      fact.campaign_id ?? fact.campaign_name,
      fact.adset_id ?? fact.adset_name,
    ]);
  const hasAdset = (fact: StoredFact) => Boolean(fact.adset_id || fact.adset_name);
  const isMetaDetail = (fact: StoredFact) =>
    fact.platform === "meta_ads" && Boolean(fact.ad_id || fact.ad_name);
  const metaCampaignSummaryKeys = new Set(
    facts
      .filter(
        (fact) => fact.platform === "meta_ads" && !isMetaDetail(fact) && !hasAdset(fact),
      )
      .map(campaignRollupKey),
  );
  const metaAdsetSummaryKeys = new Set(
    facts
      .filter((fact) => fact.platform === "meta_ads" && !isMetaDetail(fact) && hasAdset(fact))
      .map(adsetRollupKey),
  );
  const byCurrency = new Map<
    string,
    {
      total: Bucket;
      daily: Map<string, { total: Bucket; meta: Bucket; google: Bucket }>;
      platforms: Map<AdPlatform, Bucket>;
      accountIds: Map<AdPlatform, Set<string>>;
      campaigns: Map<
        string,
        {
          id: string | null;
          name: string;
          platform: AdPlatform;
          campaign_status: string | null;
          status_occurred_on: string | null;
          total: Bucket;
          adsets: Map<
            string,
            {
              name: string;
              total: Bucket;
              ads: Map<
                string,
                {
                  name: string;
                  total: Bucket;
                  thumbnail_url: string | null;
                  story_id: string | null;
                }
              >;
            }
          >;
        }
      >;
    }
  >();

  for (const fact of facts) {
    const account = accountById.get(fact.account_id);
    if (!account) continue;
    const currency = account.currency;
    let group = byCurrency.get(currency);
    if (!group) {
      group = {
        total: empty(),
        daily: new Map(),
        platforms: new Map(),
        accountIds: new Map(),
        campaigns: new Map(),
      };
      byCurrency.set(currency, group);
    }
    let accountIds = group.accountIds.get(fact.platform);
    if (!accountIds) {
      accountIds = new Set();
      group.accountIds.set(fact.platform, accountIds);
    }
    accountIds.add(fact.account_id);
    const metaDetail = isMetaDetail(fact);
    const campaignSummaryExists = metaCampaignSummaryKeys.has(campaignRollupKey(fact));
    const isCampaignSummary =
      fact.platform === "meta_ads" && !metaDetail && !hasAdset(fact);
    const contributesToRollup = campaignSummaryExists
      ? isCampaignSummary
      : !(metaDetail && metaAdsetSummaryKeys.has(adsetRollupKey(fact)));
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
    if (!platform) {
      platform = empty();
      group.platforms.set(fact.platform, platform);
    }
    if (contributesToRollup) add(platform, fact, args.conversionFields);

    const campaignKey = campaignReportKey(fact.platform, fact.campaign_id, fact.campaign_name);
    let campaign = group.campaigns.get(campaignKey);
    if (!campaign) {
      campaign = {
        id: fact.campaign_id,
        name: fact.campaign_name || "Sem campanha",
        platform: fact.platform,
        campaign_status: null,
        status_occurred_on: null,
        total: empty(),
        adsets: new Map(),
      };
      group.campaigns.set(campaignKey, campaign);
    }
    const campaignStatus = fact.campaign_status?.trim() || null;
    if (
      campaignStatus &&
      (campaign.status_occurred_on == null || fact.occurred_on >= campaign.status_occurred_on)
    ) {
      campaign.campaign_status = campaignStatus;
      campaign.status_occurred_on = fact.occurred_on;
    }
    if (contributesToRollup) add(campaign.total, fact, args.conversionFields);
    // Uma linha agregada no nível da campanha alimenta os KPIs da campanha,
    // mas não representa um conjunto real no drill-down.
    if (fact.platform === "meta_ads" && !metaDetail && !hasAdset(fact)) continue;
    const adsetName = fact.adset_name || "Sem conjunto";
    const adsetKey = fact.adset_id ?? adsetName;
    let adset = campaign.adsets.get(adsetKey);
    if (!adset) {
      adset = { name: adsetName, total: empty(), ads: new Map() };
      campaign.adsets.set(adsetKey, adset);
    }
    const contributesToAdset =
      !(metaDetail && metaAdsetSummaryKeys.has(adsetRollupKey(fact)));
    if (contributesToAdset) add(adset.total, fact, args.conversionFields);
    if (fact.platform === "meta_ads" && !metaDetail) continue;
    const adName = fact.ad_name || "Sem anúncio";
    const adKey = fact.ad_id ?? adName;
    let ad = adset.ads.get(adKey);
    if (!ad) {
      ad = {
        name: adName,
        total: empty(),
        thumbnail_url: fact.thumbnail_url,
        story_id: fact.story_id,
      };
      adset.ads.set(adKey, ad);
    }
    if (!ad.thumbnail_url && fact.thumbnail_url) ad.thumbnail_url = fact.thumbnail_url;
    if (!ad.story_id && fact.story_id) ad.story_id = fact.story_id;
    add(ad.total, fact, args.conversionFields);
  }

  const reachForAccounts = (accountIds: Iterable<string> | undefined): number | null => {
    if (!accountIds || !args.accountReach) return null;
    let total = 0;
    let available = false;
    for (const accountId of accountIds) {
      const reach = args.accountReach.get(accountId);
      if (reach == null) continue;
      total += reach;
      available = true;
    }
    return available ? total : null;
  };

  return [...byCurrency.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, group]) => {
      const metaReach = reachForAccounts(group.accountIds.get("meta_ads"));
      return {
        currency,
        summary: ratios(group.total, args.model, metaReach),
        daily: [...group.daily.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, value]) => ({
            date,
            spend_meta: value.meta.spend,
            spend_google: value.google.spend,
            conversions: value.total.conversions,
            revenue: value.total.revenue,
          })),
        platforms: [...group.platforms.entries()].map(([platform, value]) => ({
          platform,
          ...ratios(
            value,
            args.model,
            platform === "meta_ads" ? reachForAccounts(group.accountIds.get(platform)) : null,
          ),
        })),
        campaigns: [...group.campaigns.values()]
          .filter((campaign) => hasDelivery(campaign.total))
          .sort((a, b) => b.total.spend - a.total.spend)
          .map((campaign) => ({
            name: campaign.name,
            platform: campaign.platform,
            campaign_status: campaign.campaign_status,
            ...ratios(
              campaign.total,
              args.model,
              args.campaignReach?.get(
                campaignReportKey(campaign.platform, campaign.id, campaign.name),
              ) ?? null,
            ),
            adsets: [...campaign.adsets.values()].map((adset) => ({
              name: adset.name,
              ...ratios(adset.total, args.model),
              ads: [...adset.ads.values()].map((ad) => ({
                name: ad.name,
                ...ratios(ad.total, args.model),
                thumbnail_url: ad.thumbnail_url,
                story_id: ad.story_id,
              })),
            })),
          })),
      };
    });
}
