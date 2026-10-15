import "server-only";

import {
  ACCOUNT_FETCH_CONCURRENCY,
  filterRowsForAccount,
  mapWithConcurrency,
  type AccountRow,
} from "./account-fetch";
import { fetchWindsorAccountRowsForRange } from "./client";
import { repairMojibake } from "./normalizer";
import { WINDSOR_REQUEST_TIMEOUT_MS, type DateRange } from "./request";
import type { WindsorRow } from "./types";

export const GOOGLE_KEYWORD_FIELDS = [
  "account_id",
  "keyword_text",
  "keyword_match_type",
  "impressions",
  "clicks",
  "conversions",
  "cost",
  "ctr",
] as const;

export type GoogleKeyword = {
  currency: string;
  keyword: string;
  impressions: number;
  clicks: number;
  conversions: number;
  ctr: number;
  cost_per_conversion: number | null;
};

export type GoogleKeywordFetcher = (
  fields: readonly string[],
  accountId: string,
  platform: "google_ads",
  range: DateRange,
  timeoutMs?: number,
) => Promise<WindsorRow[]>;

type KeywordRowsByAccount = {
  account: AccountRow;
  rows: WindsorRow[];
};

function numeric(row: WindsorRow, field: string): number {
  const value = row[field];
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.trim().replace(",", "."))
        : Number.NaN;
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function keywordText(row: WindsorRow): string {
  const value = row.keyword_text;
  return typeof value === "string" ? repairMojibake(value.trim()) : "";
}

function deduplicateKeywordRows(rows: WindsorRow[]): WindsorRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = JSON.stringify([
      row.account_id,
      row.date,
      row.campaign_id ?? row.campaign_name ?? row.campaign,
      row.ad_group_id ?? row.ad_group_name,
      keywordText(row),
      row.keyword_match_type,
      numeric(row, "impressions"),
      numeric(row, "clicks"),
      numeric(row, "conversions"),
      numeric(row, "cost"),
      numeric(row, "ctr"),
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function aggregateGoogleKeywords(
  rowsByAccount: KeywordRowsByAccount[],
): GoogleKeyword[] {
  const aggregate = new Map<
    string,
    {
      currency: string;
      keyword: string;
      impressions: number;
      clicks: number;
      conversions: number;
      cost: number;
    }
  >();

  for (const { account, rows } of rowsByAccount) {
    for (const row of deduplicateKeywordRows(rows)) {
      const keyword = keywordText(row);
      const impressions = numeric(row, "impressions");
      if (!keyword || impressions <= 0) continue;
      const key = JSON.stringify([account.currency, keyword]);
      const current = aggregate.get(key) ?? {
        currency: account.currency,
        keyword,
        impressions: 0,
        clicks: 0,
        conversions: 0,
        cost: 0,
      };
      current.impressions += impressions;
      current.clicks += numeric(row, "clicks");
      current.conversions += numeric(row, "conversions");
      current.cost += numeric(row, "cost");
      aggregate.set(key, current);
    }
  }

  return [...aggregate.values()]
    .map((keyword) => ({
      currency: keyword.currency,
      keyword: keyword.keyword,
      impressions: keyword.impressions,
      clicks: keyword.clicks,
      conversions: keyword.conversions,
      ctr: (keyword.clicks / keyword.impressions) * 100,
      cost_per_conversion:
        keyword.conversions > 0 ? keyword.cost / keyword.conversions : null,
    }))
    .sort(
      (a, b) =>
        a.currency.localeCompare(b.currency) ||
        b.conversions - a.conversions ||
        b.clicks - a.clicks ||
        a.keyword.localeCompare(b.keyword, "pt-BR"),
    );
}

export async function fetchGoogleKeywords(
  accounts: AccountRow[],
  range: DateRange,
  fetcher: GoogleKeywordFetcher = fetchWindsorAccountRowsForRange,
  deadlineAt = Date.now() + WINDSOR_REQUEST_TIMEOUT_MS,
): Promise<GoogleKeyword[]> {
  const selected = [
    ...new Map(
      accounts
        .filter((account) => account.platform === "google_ads")
        .map((account) => [`${account.platform}:${account.account_id}`, account]),
    ).values(),
  ];
  if (selected.length === 0) return [];

  const collected: KeywordRowsByAccount[] = [];
  let failure: unknown;
  await mapWithConcurrency(selected, ACCOUNT_FETCH_CONCURRENCY, async (account) => {
    if (failure) return;
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 0) {
      failure = new Error("windsor_google_keywords_deadline");
      return;
    }
    try {
      const rows = await fetcher(
        GOOGLE_KEYWORD_FIELDS,
        account.account_id,
        "google_ads",
        range,
        Math.min(WINDSOR_REQUEST_TIMEOUT_MS, remainingMs),
      );
      collected.push({ account, rows: filterRowsForAccount(rows, account) });
    } catch (error) {
      failure = error;
    }
  });
  if (failure || collected.length !== selected.length) {
    throw new Error("windsor_google_keywords_unavailable");
  }
  return aggregateGoogleKeywords(collected);
}
