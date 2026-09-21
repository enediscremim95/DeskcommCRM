import { accountId, platformOf } from "./normalizer";
import { BUDGET_FIELDS, CONVERSION_FIELDS, type AdPlatform, type WindsorRow } from "./types";

const COMMON_FIELDS = [
  "date", "account_id", "account_name", "account_currency", "currency", "campaign_id",
] as const;
const META_CONVERSION_FIELDS = CONVERSION_FIELDS.filter((field) => field !== "conversions");
const META_DIMENSION_FIELDS = [
  ...COMMON_FIELDS, "campaign", "campaign_objective", "adset_id", "adset_name", "ad_id", "ad_name",
] as const;

const META_DETAIL_FIELDS = {
  core: [
    ...META_DIMENSION_FIELDS,
    "campaign_effective_status",
    "website_destination_url",
    "spend",
    "impressions",
    "reach",
    "clicks",
    ...BUDGET_FIELDS,
  ],
  conversions: [...META_DIMENSION_FIELDS, ...META_CONVERSION_FIELDS, "action_values_purchase"],
  video: [
    ...META_DIMENSION_FIELDS, "video_view", "actions_video_view",
    "video_p25_watched_actions_video_view", "video_p50_watched_actions_video_view",
    "video_p75_watched_actions_video_view", "video_p95_watched_actions_video_view",
  ],
  media: ["account_id", "ad_id", "ad_name", "thumbnail_url", "image_url", "effective_object_story_id"],
} as const;

export const WINDSOR_FIELDS_BY_PLATFORM: Record<AdPlatform, readonly string[]> = {
  meta_ads: [...new Set([
    ...META_DETAIL_FIELDS.core, ...META_DETAIL_FIELDS.conversions,
    ...META_DETAIL_FIELDS.video, ...META_DETAIL_FIELDS.media,
  ])],
  google_ads: [
    ...COMMON_FIELDS, "campaign_name", "campaign_objective", "campaign_status", "ad_final_urls", "cost",
    "impressions", "clicks", "conversions", "conversion_value",
  ],
};

export const WINDSOR_SUMMARY_FIELDS_BY_PLATFORM: Record<AdPlatform, readonly string[]> = {
  meta_ads: [...new Set(WINDSOR_FIELDS_BY_PLATFORM.meta_ads.filter((field) => ![
    "ad_id", "ad_name", "thumbnail_url", "image_url", "effective_object_story_id",
    "website_destination_url",
  ].includes(field)))],
  google_ads: WINDSOR_FIELDS_BY_PLATFORM.google_ads,
};

const ACCOUNT_FETCH_CONCURRENCY = 3;
export const WINDSOR_FETCH_DEADLINE_MS = 450_000;

export interface AccountRow {
  organization_id: string;
  account_id: string;
  platform: AdPlatform;
  account_name: string;
  currency: string;
}

export type AccountFetchResult = { rows: WindsorRow[]; error?: never } | { rows?: never; error: unknown };
export type WindsorAccountFetcher = (
  fields: readonly string[],
  accountId: string,
  platform: AdPlatform,
  days?: 30 | 90,
) => Promise<WindsorRow[]>;

export function accountKey(account: Pick<AccountRow, "platform" | "account_id">): string {
  return `${account.platform}:${account.account_id}`;
}

function sameAccountId(actual: string, expected: string, platform: AdPlatform): boolean {
  if (platform !== "meta_ads") return actual === expected;
  return actual.replace(/^act_/, "") === expected.replace(/^act_/, "");
}

export function filterRowsForAccount(rows: WindsorRow[], account: AccountRow): WindsorRow[] {
  return rows
    .filter((row) => {
      const actual = accountId(row);
      const declaredSource = [row.data_source, row.source, row.connector]
        .some((value) => typeof value === "string" && value.trim().length > 0);
      return Boolean(actual)
        && sameAccountId(actual, account.account_id, account.platform)
        && (!declaredSource || platformOf(row) === account.platform);
    })
    .map((row) => ({ ...row, account_id: account.account_id }));
}

async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      if (item !== undefined) await worker(item);
    }
  });
  await Promise.all(runners);
}

function detailKey(row: WindsorRow): string {
  return JSON.stringify([
    row.date, row.campaign_id ?? row.campaign, row.adset_id ?? row.adset_name, row.ad_id ?? row.ad_name,
  ]);
}

function mergeDetailRows(parts: WindsorRow[][]): WindsorRow[] {
  const merged = new Map<string, WindsorRow>();
  const media = new Map<string, WindsorRow>();
  for (const rows of parts) {
    for (const row of rows) {
      const ad = String(row.ad_id ?? row.ad_name ?? "");
      if (!row.date && ad) {
        media.set(ad, { ...(media.get(ad) ?? {}), ...row });
        continue;
      }
      const key = detailKey(row);
      merged.set(key, { ...(merged.get(key) ?? {}), ...row });
    }
  }
  return [...merged.values()].map((row) => {
    const ad = String(row.ad_id ?? row.ad_name ?? "");
    return ad && media.has(ad) ? { ...row, ...media.get(ad) } : row;
  });
}

export async function fetchSelectedAccountRows(
  accounts: AccountRow[],
  fetcher: WindsorAccountFetcher,
  deadlineAt = Date.now() + WINDSOR_FETCH_DEADLINE_MS,
): Promise<Map<string, AccountFetchResult>> {
  const unique = [...new Map(accounts.map((account) => [accountKey(account), account])).values()];
  const partial = new Map<string, Partial<Record<"summary" | "core" | "conversions" | "video" | "media", WindsorRow[]>> & { error?: unknown }>();

  await mapWithConcurrency(unique, ACCOUNT_FETCH_CONCURRENCY, async (account) => {
    const key = accountKey(account);
    const current: Partial<Record<"summary" | "core" | "conversions" | "video" | "media", WindsorRow[]>> & { error?: unknown } = {};
    partial.set(key, current);
    const requests = account.platform === "meta_ads"
      ? [
          { kind: "summary" as const, fields: WINDSOR_SUMMARY_FIELDS_BY_PLATFORM.meta_ads, days: 90 as const },
          { kind: "core" as const, fields: META_DETAIL_FIELDS.core, days: 30 as const },
          { kind: "conversions" as const, fields: META_DETAIL_FIELDS.conversions, days: 30 as const },
          { kind: "video" as const, fields: META_DETAIL_FIELDS.video, days: 30 as const },
          { kind: "media" as const, fields: META_DETAIL_FIELDS.media, days: 30 as const },
        ]
      : [{
          kind: "summary" as const,
          fields: WINDSOR_SUMMARY_FIELDS_BY_PLATFORM.google_ads,
          days: 90 as const,
        }];

    for (const { kind, fields, days } of requests) {
      if (Date.now() >= deadlineAt) {
        current.error = new Error("windsor_sync_deadline");
        return;
      }
      try {
        current[kind] = filterRowsForAccount(
          await fetcher(fields, account.account_id, account.platform, days),
          account,
        );
      } catch (error) {
        current.error = error;
        return;
      }
    }
  });

  const results = new Map<string, AccountFetchResult>();
  for (const account of unique) {
    const current = partial.get(accountKey(account));
    if (!current || current.error) {
      results.set(accountKey(account), { error: current?.error ?? new Error("windsor_account_not_fetched") });
      continue;
    }
    const details = mergeDetailRows([
      current.core ?? [], current.conversions ?? [], current.video ?? [], current.media ?? [],
    ]);
    results.set(accountKey(account), { rows: [...(current.summary ?? []), ...details] });
  }
  return results;
}
