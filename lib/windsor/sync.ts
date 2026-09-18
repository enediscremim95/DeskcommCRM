import "server-only";

import { randomUUID } from "node:crypto";

import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchWindsorRows } from "./client";
import { accountId, deduplicateRows, normalizeFacts } from "./normalizer";
import { CONVERSION_FIELDS, type AdPlatform, type WindsorRow } from "./types";

export const WINDSOR_FIELDS = [
  "date", "data_source", "account_id", "account_name", "account_currency", "currency",
  "campaign_id", "campaign_name", "campaign", "campaign_objective",
  "adset_id", "adset_name", "ad_id", "ad_name", "spend", "cost",
  "impressions", "reach", "clicks", "actions_link_click",
  ...CONVERSION_FIELDS,
  "action_values_purchase", "conversion_value", "video_view", "actions_video_view",
  "video_p25_watched_actions_video_view", "video_p50_watched_actions_video_view",
  "video_p75_watched_actions_video_view", "video_p95_watched_actions_video_view",
  "thumbnail_url", "image_url", "effective_object_story_id",
] as const;

interface ConfigRow {
  organization_id: string;
  model: "leads" | "messages" | "ecommerce";
  conversion_fields: string[];
  revenue_field: string | null;
  enabled: boolean;
}
interface AccountRow {
  organization_id: string;
  account_id: string;
  platform: AdPlatform;
  account_name: string;
  currency: string;
}
interface SyncOptions {
  trigger: "cron" | "manual";
  organizationId?: string;
  actorUserId?: string;
  preloadedRows?: WindsorRow[];
}
export interface SyncSummary {
  configured: boolean;
  organizations: number;
  succeeded: number;
  failed: number;
  rows_written: number;
}

function sanitizeError(error: unknown): { code: string; message: string } {
  const raw = error instanceof Error ? error.message : String(error);
  const key = process.env.WINDSOR_API_KEY;
  let clean = key ? raw.replaceAll(key, "[REDACTED]") : raw;
  clean = clean.replace(/api_key=[^&\s]+/gi, "api_key=[REDACTED]");
  return {
    code: /^[a-z0-9_]+$/i.test(clean) ? clean : "windsor_sync_failed",
    message: clean.slice(0, 500),
  };
}
function numeric(row: WindsorRow, ...keys: string[]): number {
  for (const key of keys) {
    const value = row[key];
    const parsed = typeof value === "number" ? value : Number(value ?? 0);
    if (Number.isFinite(parsed)) return Math.max(0, parsed);
  }
  return 0;
}
function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}
/**
 * Uma rodada busca o bulk uma vez e o reaproveita para todas as organizações.
 * O filtro por account_id é repetido mesmo nas buscas individuais porque o
 * Windsor ignora esse parâmetro em alguns conectores.
 */
export async function syncTrafficDashboards(options: SyncOptions): Promise<SyncSummary> {
  const admin = createAdminClient();
  let configQuery = admin
    .from("traffic_dashboard_configs" as never)
    .select("organization_id,model,conversion_fields,revenue_field,enabled");
  if (options.organizationId) configQuery = configQuery.eq("organization_id", options.organizationId);
  const { data: configData, error: configError } = await configQuery;
  if (configError) throw new Error(`traffic_config_read_failed: ${configError.message}`);
  const configs = (configData ?? []) as unknown as ConfigRow[];
  const enabled = configs.filter((config) => config.enabled);
  if (enabled.length === 0) {
    return { configured: false, organizations: 0, succeeded: 0, failed: 0, rows_written: 0 };
  }

  const organizationIds = enabled.map((config) => config.organization_id);
  const { data: accountData, error: accountError } = await admin
    .from("traffic_dashboard_accounts" as never)
    .select("organization_id,account_id,platform,account_name,currency")
    .in("organization_id", organizationIds);
  if (accountError) throw new Error(`traffic_accounts_read_failed: ${accountError.message}`);
  const accounts = (accountData ?? []) as unknown as AccountRow[];

  let bulk: WindsorRow[] = [];
  let bulkFailure: unknown = null;
  try {
    bulk = options.preloadedRows ?? (await fetchWindsorRows(WINDSOR_FIELDS));
  } catch (error) {
    bulkFailure = error;
  }
  const summary: SyncSummary = {
    configured: true,
    organizations: enabled.length,
    succeeded: 0,
    failed: 0,
    rows_written: 0,
  };

  for (const config of enabled) {
    const selected = accounts.filter((account) => account.organization_id === config.organization_id);
    const runId = randomUUID();
    const generation = randomUUID();
    const startedAt = new Date().toISOString();
    await admin.from("traffic_dashboard_sync_runs" as never).insert({
      id: runId,
      organization_id: config.organization_id,
      status: "running",
      trigger: options.trigger,
      started_at: startedAt,
    } as never);
    await admin
      .from("traffic_dashboard_configs" as never)
      .update({ sync_status: "syncing", last_sync_started_at: startedAt, last_sync_error: null } as never)
      .eq("organization_id", config.organization_id);

    try {
      if (bulkFailure) throw bulkFailure;
      if (selected.length === 0) throw new Error("windsor_no_accounts_selected");
      let received = 0;
      let removed = 0;
      let written = 0;

      for (const account of selected) {
        let rows = bulk.filter((row) => accountId(row) === account.account_id);
        const spend = rows.reduce((total, row) => total + numeric(row, "spend", "cost"), 0);
        if (rows.length === 0 || spend === 0) {
          const fallback = await fetchWindsorRows(WINDSOR_FIELDS, account.account_id);
          const strictlyFiltered = fallback.filter((row) => accountId(row) === account.account_id);
          if (strictlyFiltered.length > 0) rows = strictlyFiltered;
        }

        received += rows.length;
        const deduplicated = deduplicateRows(rows);
        removed += deduplicated.removed;
        const facts = normalizeFacts(deduplicated.rows).filter((fact) => fact.account_id === account.account_id);
        const payload = facts.map((fact) => ({
          ...fact,
          organization_id: config.organization_id,
          sync_generation: generation,
          synced_at: new Date().toISOString(),
        }));

        for (const part of chunks(payload, 400)) {
          const { error } = await admin
            .from("traffic_dashboard_facts" as never)
            .upsert(part as never, { onConflict: "organization_id,account_id,source_key" });
          if (error) throw new Error(`traffic_facts_upsert_failed: ${error.message}`);
          written += part.length;
        }
      }

      const finishedAt = new Date().toISOString();
      await admin.from("traffic_dashboard_sync_runs" as never).update({
        status: "succeeded", finished_at: finishedAt, rows_received: received,
        rows_written: written, duplicates_removed: removed,
      } as never).eq("id", runId).eq("organization_id", config.organization_id);
      const { error: publishError } = await admin.from("traffic_dashboard_configs" as never).update({
        sync_status: "ready", last_sync_succeeded_at: finishedAt, last_sync_error: null,
        published_generation: generation,
      } as never).eq("organization_id", config.organization_id);
      if (publishError) throw new Error(`traffic_generation_publish_failed: ${publishError.message}`);
      const { error: cleanupError } = await admin
        .from("traffic_dashboard_facts" as never)
        .delete()
        .eq("organization_id", config.organization_id)
        .neq("sync_generation", generation);
      if (cleanupError) {
        logger.warn("[windsor-dashboard] geração antiga não foi removida", {
          organization_id: config.organization_id,
          error_code: "traffic_facts_cleanup_failed",
        });
      }
      await audit({
        action: "traffic_dashboard.sync_succeeded",
        actorUserId: options.actorUserId ?? null,
        organizationId: config.organization_id,
        resourceType: "traffic_dashboard_sync_run",
        resourceId: runId,
        bypassedRls: true,
        actingAsPlatformAdmin: Boolean(options.actorUserId),
        metadata: { trigger: options.trigger, rows_written: written, duplicates_removed: removed },
      });
      summary.succeeded += 1;
      summary.rows_written += written;
    } catch (error) {
      const failure = sanitizeError(error);
      const finishedAt = new Date().toISOString();
      await admin.from("traffic_dashboard_sync_runs" as never).update({
        status: "failed", finished_at: finishedAt,
        error_code: failure.code, error_message: failure.message,
      } as never).eq("id", runId).eq("organization_id", config.organization_id);
      await admin.from("traffic_dashboard_configs" as never).update({
        sync_status: "failed", last_sync_error: failure.message,
      } as never).eq("organization_id", config.organization_id);
      await audit({
        action: "traffic_dashboard.sync_failed",
        actorUserId: options.actorUserId ?? null,
        organizationId: config.organization_id,
        resourceType: "traffic_dashboard_sync_run",
        resourceId: runId,
        bypassedRls: true,
        actingAsPlatformAdmin: Boolean(options.actorUserId),
        metadata: { trigger: options.trigger, error_code: failure.code },
      });
      logger.warn("[windsor-dashboard] sincronização da organização falhou", {
        organization_id: config.organization_id,
        error_code: failure.code,
      });
      summary.failed += 1;
    }
  }
  return summary;
}
