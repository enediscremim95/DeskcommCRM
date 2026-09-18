import { createHash } from "node:crypto";
import { CONVERSION_FIELDS, type AdPlatform, type NormalizedFact, type WindsorAccount, type WindsorRow } from "./types";

const MOJIBAKE = /Ã.|Â.|â[\u0080-\u00bf]/;
export function repairMojibake(value: string): string {
  if (!MOJIBAKE.test(value)) return value;
  const repaired = Buffer.from(value, "latin1").toString("utf8");
  return repaired.includes("\uFFFD") ? value : repaired;
}
function text(row: WindsorRow, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return repairMojibake(value.trim());
    if (typeof value === "number") return String(value);
  }
  return "";
}
function numeric(row: WindsorRow, ...keys: string[]): number {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, value);
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value.replace(",", "."));
      if (Number.isFinite(parsed)) return Math.max(0, parsed);
    }
  }
  return 0;
}
export function accountId(row: WindsorRow): string {
  return text(row, "account_id", "ad_account_id", "customer_id");
}
export function platformOf(row: WindsorRow): AdPlatform | null {
  const source = text(row, "data_source", "source", "connector").toLowerCase();
  if (source.includes("google")) return "google_ads";
  if (source.includes("facebook") || source.includes("meta")) return "meta_ads";
  const id = accountId(row);
  if (id.startsWith("act_")) return "meta_ads";
  return id ? "google_ads" : null;
}
export function discoverAccounts(rows: WindsorRow[]): WindsorAccount[] {
  const byId = new Map<string, WindsorAccount>();
  for (const row of rows) {
    const id = accountId(row);
    const platform = platformOf(row);
    if (!id || !platform) continue;
    const currency = text(row, "account_currency", "currency").toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) continue;
    byId.set(id, {
      id,
      platform,
      name: text(row, "account_name") || id,
      currency,
    });
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}
export function deduplicateRows(rows: WindsorRow[]): { rows: WindsorRow[]; removed: number } {
  const seen = new Set<string>();
  const unique: WindsorRow[] = [];
  for (const row of rows) {
    const key = JSON.stringify([
      accountId(row), text(row, "date"), text(row, "campaign_id", "campaign_name", "campaign"),
      text(row, "adset_id", "adset_name"), text(row, "ad_id", "ad_name"),
      String(row.spend ?? row.cost ?? ""), String(row.impressions ?? ""),
    ]);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }
  return { rows: unique, removed: rows.length - unique.length };
}
export function assertHealthyCampaignNames(rows: WindsorRow[]): void {
  const material = rows.filter((row) =>
    numeric(row, "spend", "cost") > 0 || numeric(row, "impressions") > 0 ||
    CONVERSION_FIELDS.some((field) => numeric(row, field) > 0));
  if (material.length === 0) return;
  const unnamed = material.filter((row) => !text(row, "campaign_name", "campaign")).length;
  if (unnamed / material.length > 0.5) throw new Error("windsor_campaign_names_degraded");
}
export function normalizeFacts(rows: WindsorRow[]): NormalizedFact[] {
  assertHealthyCampaignNames(rows);
  const facts: NormalizedFact[] = [];
  for (const row of rows) {
    const id = accountId(row);
    const platform = platformOf(row);
    const occurredOn = text(row, "date").slice(0, 10);
    if (!id || !platform || !/^\d{4}-\d{2}-\d{2}$/.test(occurredOn)) continue;
    const campaignName = text(row, "campaign_name", "campaign");
    const adsetName = text(row, "adset_name");
    const adName = text(row, "ad_name");
    const spend = platform === "google_ads" ? numeric(row, "cost") : numeric(row, "spend");
    const conversions = Object.fromEntries(
      CONVERSION_FIELDS
        .map((field): [string, number] => [field, numeric(row, field)])
        .filter((entry) => entry[1] > 0),
    );
    const sourceKey = createHash("sha256").update(JSON.stringify([
      id, occurredOn,
      text(row, "campaign_id") || campaignName,
      text(row, "adset_id") || adsetName,
      text(row, "ad_id") || adName,
      String(platform === "google_ads" ? row.cost ?? "" : row.spend ?? ""),
      String(row.impressions ?? ""),
    ])).digest("hex");
    facts.push({
      account_id: id, platform, occurred_on: occurredOn,
      campaign_id: text(row, "campaign_id") || null, campaign_name: campaignName,
      adset_id: text(row, "adset_id") || null, adset_name: adsetName,
      ad_id: text(row, "ad_id") || null, ad_name: adName,
      impressions: numeric(row, "impressions"), reach: numeric(row, "reach"),
      clicks: numeric(row, "clicks"), link_clicks: numeric(row, "actions_link_click", "link_clicks"),
      spend, conversions,
      revenue: platform === "google_ads" ? numeric(row, "conversion_value") : numeric(row, "action_values_purchase"),
      video_views: numeric(row, "video_view", "actions_video_view"),
      video_p25: numeric(row, "video_p25_watched_actions_video_view"),
      video_p50: numeric(row, "video_p50_watched_actions_video_view"),
      video_p75: numeric(row, "video_p75_watched_actions_video_view"),
      video_p95: numeric(row, "video_p95_watched_actions_video_view"),
      thumbnail_url: text(row, "thumbnail_url", "image_url") || null,
      story_id: text(row, "effective_object_story_id") || null,
      source_key: sourceKey,
    });
  }
  return facts;
}
