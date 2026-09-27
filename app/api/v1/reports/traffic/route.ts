import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { env } from "@/lib/env";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchWindsorCampaignReach } from "@/lib/windsor/client";
import { buildWindsorUrl, WINDSOR_REQUEST_TIMEOUT_MS } from "@/lib/windsor/request";
import {
  buildTrafficReport,
  campaignReportKey,
  latestCampaignStatuses,
  type StoredAccount,
  type StoredFact,
} from "@/lib/windsor/report";
import {
  CAMPAIGN_METRIC_COLUMNS,
  campaignMetricColumnsForPlatform,
  defaultCampaignColumns,
  type AdPlatform,
  type CampaignMetricColumn,
  type DashboardModel,
} from "@/lib/windsor/types";
import { PRIORITY_METRIC_COLUMNS, validPriorityMetrics } from "@/lib/windsor/priority-metrics";
import { serializeTrafficColumnPresets } from "@/lib/windsor/column-presets";
import { buildTrafficDelivery } from "@/lib/windsor/delivery";
import { clientCanViewIntegration } from "@/lib/integrations/access";
import {
  buildTrafficKanbanStages,
  buildTrafficRichCrmInsights,
  type TrafficLeadRow,
  type TrafficStageRow,
} from "@/lib/windsor/traffic-insights";

export const dynamic = "force-dynamic";

function canManageTrafficDefaults(user: {
  is_platform_admin: boolean;
  support?: unknown;
}): boolean {
  return user.is_platform_admin && !user.support;
}

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const querySchema = z
  .object({
    from: z.string().regex(datePattern),
    to: z.string().regex(datePattern),
  })
  .superRefine((value, context) => {
    const from = new Date(`${value.from}T00:00:00Z`);
    const to = new Date(`${value.to}T00:00:00Z`);
    const days = (to.getTime() - from.getTime()) / 86_400_000;
    if (days < 0 || days > 731)
      context.addIssue({ code: "custom", message: "Período deve ter até 731 dias." });
  });
const columnsSchema = z.object({
  columns: z
    .array(z.enum(CAMPAIGN_METRIC_COLUMNS))
    .min(1)
    .max(CAMPAIGN_METRIC_COLUMNS.length)
    .refine((columns) => new Set(columns).size === columns.length, "Colunas duplicadas."),
});
const thresholdsSchema = z.object({
  cost_thresholds: z
    .array(
      z
        .object({
          platform: z.enum(["meta_ads", "google_ads"]),
          good_until: z.number().finite().nonnegative(),
          acceptable_until: z.number().finite().nonnegative(),
        })
        .refine((value) => value.acceptable_until >= value.good_until, {
          message: "O limite aceitável deve ser maior ou igual ao limite bom.",
        }),
    )
    .max(2)
    .refine((rows) => new Set(rows.map((row) => row.platform)).size === rows.length, {
      message: "Plataformas duplicadas.",
    }),
});
const priorityMetricsSchema = z.object({
  priority_metrics: z
    .array(z.enum(PRIORITY_METRIC_COLUMNS))
    .min(1)
    .max(6)
    .refine((columns) => new Set(columns).size === columns.length, "Métricas duplicadas.")
    .nullable(),
});
const patchSchema = z.union([columnsSchema, thresholdsSchema, priorityMetricsSchema]);
const reachResponseSchema = z
  .object({
    data: z.array(z.record(z.string(), z.unknown())).optional(),
    result: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .passthrough();

async function fetchWindsorAccountReach(
  accountId: string,
  range: { from: string; to: string },
): Promise<number | null> {
  if (!env.WINDSOR_API_KEY) return null;
  const url = buildWindsorUrl(
    env.WINDSOR_API_KEY,
    ["account_id", "reach"],
    undefined,
    undefined,
    { accountId, platform: "meta_ads" },
    range,
  );
  const response = await fetch(url, {
    cache: "no-store",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(WINDSOR_REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) return null;
  const parsed = reachResponseSchema.safeParse(await response.json());
  if (!parsed.success) return null;
  const rows = parsed.data.data ?? parsed.data.result ?? [];
  const values = rows
    .filter((row) => typeof row.account_id !== "string" || row.account_id === accountId)
    .map((row) => Number(row.reach ?? 0))
    .filter((reach) => Number.isFinite(reach) && reach > 0);
  return values.length > 0 ? Math.max(...values) : null;
}

function validColumns(
  value: unknown,
  model: DashboardModel,
  platform: AdPlatform,
): CampaignMetricColumn[] {
  const parsed = z.array(z.enum(CAMPAIGN_METRIC_COLUMNS)).safeParse(value);
  if (parsed.success) {
    const allowed = new Set(campaignMetricColumnsForPlatform(platform));
    const compatible = parsed.data.filter((column) => allowed.has(column));
    if (compatible.length > 0) return compatible;
  }
  return defaultCampaignColumns(model, platform);
}

export async function GET(request: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "reports" });
  if (!authz.ok) return authz.response;
  const params = new URL(request.url).searchParams;
  const parsed = querySchema.safeParse({ from: params.get("from"), to: params.get("to") });
  if (!parsed.success) {
    return fail("validation_error", "Período inválido.", 400, {
      requestId,
      details: parsed.error.flatten(),
    });
  }
  const admin = createAdminClient();
  const organizationId = authz.org.orgId;
  if (
    !(authz.user.is_platform_admin && !authz.user.support) &&
    !(await clientCanViewIntegration(admin, organizationId, "windsor"))
  )
    return fail("forbidden", "Relatório não liberado para esta organização.", 403, { requestId });
  const { data: config, error: configError } = await admin
    .from("traffic_dashboard_configs" as never)
    .select(
      "model,conversion_fields,sync_status,last_sync_succeeded_at,last_sync_error,published_generation,campaign_metric_columns,default_meta_column_preset_id,default_google_column_preset_id,priority_metric_columns",
    )
    .eq("organization_id", organizationId)
    .eq("enabled", true)
    .maybeSingle();
  if (configError)
    return fail("internal_error", "Não foi possível ler o relatório.", 500, { requestId });
  if (!config) return fail("not_found", "Dashboard nativo não configurado.", 404, { requestId });

  const typedConfig = config as unknown as {
    model: DashboardModel;
    conversion_fields: string[];
    sync_status: string;
    last_sync_succeeded_at: string | null;
    last_sync_error: string | null;
    published_generation: string | null;
    campaign_metric_columns: unknown;
    default_meta_column_preset_id: string | null;
    default_google_column_preset_id: string | null;
    priority_metric_columns: unknown;
  };
  const fromCreatedAt = `${parsed.data.from}T00:00:00.000Z`;
  const exclusiveTo = new Date(`${parsed.data.to}T00:00:00.000Z`);
  exclusiveTo.setUTCDate(exclusiveTo.getUTCDate() + 1);
  const periodDays = Math.round(
    (exclusiveTo.getTime() - new Date(fromCreatedAt).getTime()) / 86_400_000,
  );
  const previousExclusiveTo = new Date(fromCreatedAt);
  const previousFrom = new Date(previousExclusiveTo);
  previousFrom.setUTCDate(previousFrom.getUTCDate() - periodDays);
  const previousRange = {
    from: previousFrom.toISOString().slice(0, 10),
    to: new Date(previousExclusiveTo.getTime() - 86_400_000).toISOString().slice(0, 10),
  };
  async function fetchLeadSituationRows(from: Date, to: Date) {
    const rows: TrafficLeadRow[] = [];
    const pageSize = 1_000;
    for (let offset = 0; ; offset += pageSize) {
      const result = await admin
        .from("crm_leads" as never)
        .select(
          "id,status,stage_id,pipeline_id,lost_reason,created_at,closed_at,value_cents,currency,source,source_metadata",
        )
        .eq("organization_id", organizationId)
        .gte("created_at", from.toISOString())
        .lt("created_at", to.toISOString())
        .order("created_at")
        .order("id")
        .range(offset, offset + pageSize - 1);
      if (result.error) return { data: null, error: result.error };
      const page = (result.data ?? []) as unknown as TrafficLeadRow[];
      rows.push(...page);
      if (page.length < pageSize) return { data: rows, error: null };
    }
  }
  const [
    { data: accounts, error: accountError },
    factsResult,
    deliveryFactsResult,
    previousFactsResult,
    { data: crmStages, error: crmStagesError },
    currentLeadRowsResult,
    previousLeadRowsResult,
    { data: presetRows, error: presetError },
    { data: thresholdRows, error: thresholdError },
  ] = await Promise.all([
    admin
      .from("traffic_dashboard_accounts" as never)
      .select("account_id,account_name,platform,currency")
      .eq("organization_id", organizationId),
    typedConfig.published_generation
      ? admin
          .from("traffic_dashboard_facts" as never)
          .select(
            "account_id,platform,occurred_on,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,impressions,reach,clicks,link_clicks,spend,conversions,revenue,video_views,video_p25,video_p50,video_p75,video_p95,thumbnail_url,story_id,campaign_status,destination_urls",
          )
          .eq("organization_id", organizationId)
          .eq("sync_generation", typedConfig.published_generation)
          .gte("occurred_on", parsed.data.from)
          .lte("occurred_on", parsed.data.to)
          .order("occurred_on")
      : Promise.resolve({ data: [], error: null }),
    typedConfig.published_generation
      ? admin
          .from("traffic_dashboard_facts" as never)
          .select(
            "account_id,platform,occurred_on,campaign_id,campaign_name,campaign_status,destination_urls,spend",
          )
          .eq("organization_id", organizationId)
          .eq("sync_generation", typedConfig.published_generation)
          .order("occurred_on", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    typedConfig.published_generation
      ? admin
          .from("traffic_dashboard_facts" as never)
          .select(
            "account_id,platform,occurred_on,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,impressions,reach,clicks,link_clicks,spend,conversions,revenue,video_views,video_p25,video_p50,video_p75,video_p95,thumbnail_url,story_id",
          )
          .eq("organization_id", organizationId)
          .eq("sync_generation", typedConfig.published_generation)
          .gte("occurred_on", previousRange.from)
          .lte("occurred_on", previousRange.to)
          .order("occurred_on")
      : Promise.resolve({ data: [], error: null }),
    admin
      .from("crm_stages" as never)
      .select("id,name,position,pipeline_id,is_won,is_lost")
      .eq("organization_id", organizationId)
      .eq("is_archived", false),
    fetchLeadSituationRows(new Date(fromCreatedAt), exclusiveTo),
    fetchLeadSituationRows(previousFrom, previousExclusiveTo),
    admin
      .from("traffic_dashboard_column_presets" as never)
      .select("id,name,metric_columns,platform")
      .eq("organization_id", organizationId)
      .order("name"),
    admin
      .from("traffic_report_cost_thresholds" as never)
      .select("platform,good_until,acceptable_until")
      .eq("organization_id", organizationId),
  ]);
  const factError = factsResult.error;
  const deliveryFactError = deliveryFactsResult.error;
  const previousFactError = previousFactsResult.error;
  if (
    accountError ||
    factError ||
    deliveryFactError ||
    previousFactError ||
    crmStagesError ||
    currentLeadRowsResult.error ||
    previousLeadRowsResult.error ||
    presetError ||
    thresholdError
  ) {
    return fail("internal_error", "Não foi possível ler o relatório.", 500, { requestId });
  }
  const stages = (crmStages ?? []) as unknown as TrafficStageRow[];
  const crm = buildTrafficRichCrmInsights({
    leads: currentLeadRowsResult.data ?? [],
    previousLeads: previousLeadRowsResult.data ?? [],
    stages,
    window: parsed.data,
  });
  const previousCrm = buildTrafficRichCrmInsights({
    leads: previousLeadRowsResult.data ?? [],
    stages,
    window: previousRange,
  });
  const facts = factsResult.data;
  const deliveryFacts = (deliveryFactsResult.data ?? []) as unknown as StoredFact[];
  const previousFacts = previousFactsResult.data;
  const storedAccounts = (accounts ?? []) as unknown as StoredAccount[];
  async function loadPeriodReach(range: { from: string; to: string }) {
    const campaignReach = new Map<string, number>();
    const accountReach = new Map<string, number>();
    await Promise.all(
      storedAccounts
        .filter((account) => account.platform === "meta_ads")
        .map(async (account) => {
          try {
            const [campaignResult, accountResult] = await Promise.allSettled([
              fetchWindsorCampaignReach(account.account_id, range),
              fetchWindsorAccountReach(account.account_id, range),
            ]);
            if (campaignResult.status === "fulfilled") {
              for (const row of campaignResult.value) {
                const campaignId = typeof row.campaign_id === "string" ? row.campaign_id : null;
                const campaignName = typeof row.campaign === "string" ? row.campaign : "";
                const reach = Number(row.reach ?? 0);
                if (!Number.isFinite(reach) || reach <= 0) continue;
                const key = campaignReportKey("meta_ads", campaignId, campaignName);
                campaignReach.set(key, (campaignReach.get(key) ?? 0) + reach);
              }
            }
            if (accountResult.status === "fulfilled" && accountResult.value != null) {
              accountReach.set(account.account_id, accountResult.value);
            }
          } catch {
            // O relatório continua disponível; alcance fica indisponível se o conector falhar.
          }
        }),
    );
    return { campaignReach, accountReach };
  }
  const [currentReach, previousReach] = await Promise.all([
    loadPeriodReach(parsed.data),
    loadPeriodReach(previousRange),
  ]);
  const currentCurrencies = buildTrafficReport({
    model: typedConfig.model,
    conversionFields: typedConfig.conversion_fields,
    accounts: storedAccounts,
    facts: (facts ?? []) as unknown as StoredFact[],
    window: parsed.data,
    campaignReach: currentReach.campaignReach,
    accountReach: currentReach.accountReach,
    campaignStatuses: latestCampaignStatuses(deliveryFacts),
  });
  const previousCurrencies = buildTrafficReport({
    model: typedConfig.model,
    conversionFields: typedConfig.conversion_fields,
    accounts: storedAccounts,
    facts: (previousFacts ?? []) as unknown as StoredFact[],
    window: previousRange,
    campaignReach: previousReach.campaignReach,
    accountReach: previousReach.accountReach,
  });
  const previousByCurrency = new Map(
    previousCurrencies.map((group) => [group.currency, group] as const),
  );
  const typedPresetRows = presetRows as unknown as Array<{
    id: string;
    name: string;
    metric_columns: unknown;
    platform: unknown;
  }>;
  const columnPresets = {
    meta_ads: serializeTrafficColumnPresets(
      typedPresetRows.filter((preset) => preset.platform === "meta_ads"),
      typedConfig.default_meta_column_preset_id,
    ),
    google_ads: serializeTrafficColumnPresets(
      typedPresetRows.filter((preset) => preset.platform === "google_ads"),
      typedConfig.default_google_column_preset_id,
    ),
  };
  const defaultPresets = {
    meta_ads: columnPresets.meta_ads.find((preset) => preset.is_default) ?? null,
    google_ads: columnPresets.google_ads.find((preset) => preset.is_default) ?? null,
  };
  return ok(
    {
      model: typedConfig.model,
      organization_key: organizationId,
      viewer_key: authz.user.id,
      default_columns: {
        meta_ads:
          defaultPresets.meta_ads?.columns ??
          validColumns(typedConfig.campaign_metric_columns, typedConfig.model, "meta_ads"),
        google_ads:
          defaultPresets.google_ads?.columns ??
          validColumns(typedConfig.campaign_metric_columns, typedConfig.model, "google_ads"),
      },
      default_preset_ids: {
        meta_ads: defaultPresets.meta_ads?.id ?? null,
        google_ads: defaultPresets.google_ads?.id ?? null,
      },
      column_presets: columnPresets,
      can_manage_defaults: canManageTrafficDefaults(authz.user),
      priority_metrics: validPriorityMetrics(
        typedConfig.priority_metric_columns,
        typedConfig.model,
      ),
      cost_thresholds: (thresholdRows ?? []).map((row) => {
        const typed = row as unknown as {
          platform: "meta_ads" | "google_ads";
          good_until: number | string;
          acceptable_until: number | string;
        };
        return {
          platform: typed.platform,
          good_until: Number(typed.good_until),
          acceptable_until: Number(typed.acceptable_until),
        };
      }),
      sync: {
        status: typedConfig.sync_status,
        last_succeeded_at: typedConfig.last_sync_succeeded_at,
        error: typedConfig.last_sync_error,
      },
      window: { from: parsed.data.from, to: parsed.data.to },
      previous_window: previousRange,
      crm: {
        ...crm,
        previous: previousCrm,
      },
      kanban_stages: buildTrafficKanbanStages(currentLeadRowsResult.data ?? [], stages),
      delivery: buildTrafficDelivery((facts ?? []) as unknown as StoredFact[], deliveryFacts),
      currencies: currentCurrencies.map((group) => ({
        ...group,
        comparison: previousByCurrency.get(group.currency)?.summary ?? null,
      })),
    },
    { requestId },
  );
}

export async function PATCH(request: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "reports" });
  if (!authz.ok) return authz.response;
  if (!canManageTrafficDefaults(authz.user)) {
    return fail("forbidden", "Apenas o admin da plataforma pode alterar o padrão.", 403, {
      requestId,
    });
  }
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_error", "Configuração inválida.", 400, {
      requestId,
      details: parsed.error.flatten(),
    });
  }
  const organizationId = authz.org.orgId;
  const admin = createAdminClient();
  if ("priority_metrics" in parsed.data) {
    const { error } = await admin
      .from("traffic_dashboard_configs" as never)
      .update({ priority_metric_columns: parsed.data.priority_metrics } as never)
      .eq("organization_id", organizationId)
      .eq("enabled", true);
    if (error) {
      return fail("internal_error", "Não foi possível salvar as métricas prioritárias.", 500, {
        requestId,
      });
    }
    await audit({
      action: "traffic_dashboard.priority_metrics_updated",
      actorUserId: authz.user.id,
      organizationId,
      resourceType: "traffic_dashboard_config",
      resourceId: organizationId,
      bypassedRls: true,
      actingAsPlatformAdmin: true,
      metadata: { metrics: parsed.data.priority_metrics },
    });
    return ok({ priority_metrics: parsed.data.priority_metrics }, { requestId });
  }
  if ("cost_thresholds" in parsed.data) {
    if (parsed.data.cost_thresholds.length > 0) {
      const { error: insertError } = await admin
        .from("traffic_report_cost_thresholds" as never)
        .upsert(
          parsed.data.cost_thresholds.map((row) => ({
            organization_id: organizationId,
            platform: row.platform,
            good_until: row.good_until,
            acceptable_until: row.acceptable_until,
            updated_by: authz.user.id,
          })) as never,
          { onConflict: "organization_id,platform" },
        );
      if (insertError) {
        return fail("internal_error", "Não foi possível salvar os limites de custo.", 500, {
          requestId,
        });
      }
    }
    const configured = new Set(parsed.data.cost_thresholds.map((row) => row.platform));
    for (const platform of ["meta_ads", "google_ads"] as const) {
      if (configured.has(platform)) continue;
      const { error: deleteError } = await admin
        .from("traffic_report_cost_thresholds" as never)
        .delete()
        .eq("organization_id", organizationId)
        .eq("platform", platform);
      if (deleteError) {
        return fail("internal_error", "Não foi possível salvar os limites de custo.", 500, {
          requestId,
        });
      }
    }
    await audit({
      action: "traffic_dashboard.cost_thresholds_updated",
      actorUserId: authz.user.id,
      organizationId,
      resourceType: "traffic_report_cost_thresholds",
      resourceId: organizationId,
      bypassedRls: true,
      actingAsPlatformAdmin: true,
      metadata: { platforms: parsed.data.cost_thresholds.map((row) => row.platform) },
    });
    return ok({ cost_thresholds: parsed.data.cost_thresholds }, { requestId });
  }
  const { error } = await admin
    .from("traffic_dashboard_configs" as never)
    .update({ campaign_metric_columns: parsed.data.columns } as never)
    .eq("organization_id", organizationId)
    .eq("enabled", true);
  if (error) {
    return fail("internal_error", "Não foi possível salvar o padrão de colunas.", 500, {
      requestId,
    });
  }
  await audit({
    action: "traffic_dashboard.configuration_updated",
    actorUserId: authz.user.id,
    organizationId,
    resourceType: "traffic_dashboard_config",
    resourceId: organizationId,
    bypassedRls: true,
    actingAsPlatformAdmin: true,
    metadata: { columns: parsed.data.columns },
  });
  return ok({ columns: parsed.data.columns }, { requestId });
}
