import type { AdPlatform } from "./types";

export type TrafficDeliveryFact = {
  account_id: string;
  platform: AdPlatform;
  occurred_on?: string;
  campaign_id: string | null;
  campaign_name: string;
  campaign_status?: string | null;
  destination_urls?: string[] | null;
  spend: number | string;
};

export type TrafficDeliveryCampaign = {
  name: string;
  platform: AdPlatform;
};

export type TrafficDelivery = {
  active_campaigns: TrafficDeliveryCampaign[];
  invested_campaigns: TrafficDeliveryCampaign[];
  pages: string[];
};

const ACTIVE_STATUS: Record<AdPlatform, ReadonlySet<string>> = {
  meta_ads: new Set(["ACTIVE"]),
  google_ads: new Set(["ENABLED"]),
};

function campaignKey(fact: TrafficDeliveryFact): string {
  return JSON.stringify([
    fact.platform,
    fact.account_id,
    fact.campaign_id ?? fact.campaign_name.trim().toLocaleLowerCase("pt-BR"),
  ]);
}

function campaignDisplayKey(campaign: TrafficDeliveryCampaign): string {
  return `${campaign.platform}:${campaign.name.trim().toLocaleLowerCase("pt-BR")}`;
}

export function cleanDestinationUrl(value: string): string | null {
  const candidate = value.trim();
  if (!candidate) return null;
  try {
    const parsed = new URL(/^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`);
    if (!/^https?:$/.test(parsed.protocol)) return null;
    const path = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/$/, "");
    return `${parsed.hostname.toLocaleLowerCase("en-US")}${path}`;
  } catch {
    return null;
  }
}

export function buildTrafficDelivery(
  periodFacts: TrafficDeliveryFact[],
  snapshotFacts: TrafficDeliveryFact[] = periodFacts,
): TrafficDelivery {
  const byCampaign = new Map<
    string,
    {
      campaign: TrafficDeliveryCampaign;
      latestStatusDate: string;
      statuses: Set<string>;
      spend: number;
      latestUrls: Set<string>;
      periodUrls: Set<string>;
    }
  >();

  const campaignFor = (fact: TrafficDeliveryFact) => {
    const name = fact.campaign_name.trim();
    if (!name) return null;
    const key = campaignKey(fact);
    const current = byCampaign.get(key) ?? {
      campaign: { name, platform: fact.platform },
      latestStatusDate: "",
      statuses: new Set<string>(),
      spend: 0,
      latestUrls: new Set<string>(),
      periodUrls: new Set<string>(),
    };
    byCampaign.set(key, current);
    return current;
  };

  for (const fact of snapshotFacts) {
    const current = campaignFor(fact);
    if (!current) continue;
    const status = fact.campaign_status?.trim().toUpperCase();
    const statusDate = fact.occurred_on ?? "";
    if (status && statusDate >= current.latestStatusDate) {
      if (statusDate > current.latestStatusDate) {
        current.statuses.clear();
        current.latestUrls.clear();
      }
      current.latestStatusDate = statusDate;
      current.statuses.add(status);
      for (const raw of fact.destination_urls ?? []) {
        const clean = cleanDestinationUrl(raw);
        if (clean) current.latestUrls.add(clean);
      }
    }
  }

  for (const fact of periodFacts) {
    const current = campaignFor(fact);
    if (!current) continue;
    const spend = Number(fact.spend ?? 0);
    if (Number.isFinite(spend) && spend > 0) current.spend += spend;
    for (const raw of fact.destination_urls ?? []) {
      const clean = cleanDestinationUrl(raw);
      if (clean) current.periodUrls.add(clean);
    }
  }

  const active = new Map<string, TrafficDeliveryCampaign>();
  const invested = new Map<string, TrafficDeliveryCampaign>();
  const pages = new Set<string>();

  for (const current of byCampaign.values()) {
    const hasStatus = current.statuses.size > 0;
    const isActive = [...current.statuses].some((status) =>
      ACTIVE_STATUS[current.campaign.platform].has(status),
    );
    const isInvestedFallback = !hasStatus && current.spend > 0;
    if (!isActive && !isInvestedFallback) continue;
    const displayKey = campaignDisplayKey(current.campaign);
    (isActive ? active : invested).set(displayKey, current.campaign);
    const relevantPages = isActive ? current.latestUrls : current.periodUrls;
    for (const page of relevantPages) pages.add(page);
  }

  for (const key of active.keys()) invested.delete(key);
  const sortCampaigns = (items: Iterable<TrafficDeliveryCampaign>) =>
    [...items].sort((a, b) =>
      a.name.localeCompare(b.name, "pt-BR") || a.platform.localeCompare(b.platform),
    );

  return {
    active_campaigns: sortCampaigns(active.values()),
    invested_campaigns: sortCampaigns(invested.values()),
    pages: [...pages].sort((a, b) => a.localeCompare(b, "pt-BR")),
  };
}
