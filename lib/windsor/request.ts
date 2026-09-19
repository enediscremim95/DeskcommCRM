import type { AdPlatform } from "./types";

const BASE_URL = "https://connectors.windsor.ai";
export const WINDSOR_REQUEST_TIMEOUT_MS = 75_000;
const CONNECTOR_BY_PLATFORM: Record<AdPlatform, string> = {
  meta_ads: "facebook",
  google_ads: "google_ads",
};

export interface AccountSelection {
  accountId: string;
  platform: AdPlatform;
}

export interface DateRange {
  from: string;
  to: string;
}

export function buildWindsorUrl(
  apiKey: string,
  fields: readonly string[],
  preset: string | undefined,
  legacyAccountId?: string,
  selection?: AccountSelection,
  dateRange?: DateRange,
): URL {
  const connector = selection ? CONNECTOR_BY_PLATFORM[selection.platform] : "all";
  const url = new URL(`${BASE_URL}/${connector}`);
  url.searchParams.set("api_key", apiKey);
  if (dateRange) {
    url.searchParams.set("date_from", dateRange.from);
    url.searchParams.set("date_to", dateRange.to);
  } else if (preset) {
    url.searchParams.set("date_preset", preset);
  }
  url.searchParams.set("fields", fields.join(","));
  if (legacyAccountId) url.searchParams.set("account_id", legacyAccountId);
  if (selection) url.searchParams.set("select_accounts", selection.accountId);
  return url;
}

export function isTimeoutError(error: unknown): boolean {
  const name = error instanceof Error ? error.name : "";
  return name === "TimeoutError" || name === "AbortError";
}
