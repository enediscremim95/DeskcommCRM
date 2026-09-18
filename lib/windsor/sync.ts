import "server-only";

import { randomUUID } from "node:crypto";

import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  accountKey,
  fetchSelectedAccountRows,
  filterRowsForAccount,
  type AccountFetchResult,
  type AccountRow,
} from "./account-fetch";
import { fetchWindsorAccountRows } from "./client";
import { deduplicateRows, normalizeFactsForAccount } from "./normalizer";
import type { WindsorRow } from "./types";

interface ConfigRow {
  organization_id: string;
  model: "leads" | "messages" | "ecommerce";
  conversion_fields: string[];
  revenue_field: string | null;
  enabled: boolean;
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
function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

/**
 * Cada conta é buscada uma vez no conector da sua plataforma, com concorrência
 * limitada. O filtro local permanece obrigatório antes de qualquer gravação.
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

  const fetched = options.preloadedRows
    ? new Map(
        accounts.map((account) => [
          accountKey(account),
          { rows: filterRowsForAccount(options.preloadedRows ?? [], account) } as AccountFetchResult,
        ]),
      )
    : await fetchSelectedAccountRows(accounts, fetchWindsorAccountRows);
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
      if (selected.length === 0) throw new Error("windsor_no_accounts_selected");
      let received = 0;
      let removed = 0;
      let written = 0;

      for (const account of selected) {
        const result = fetched.get(accountKey(account));
        if (!result) throw new Error("windsor_account_not_fetched");
        if ("error" in result) throw result.error;
        const rows = result.rows;

        received += rows.length;
        const deduplicated = deduplicateRows(rows);
        removed += deduplicated.removed;
        const facts = normalizeFactsForAccount(deduplicated.rows, account);
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
