import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchWindsorCampaignReach } from "@/lib/windsor/client";
import {
  buildTrafficReport,
  campaignReportKey,
  type StoredAccount,
  type StoredFact,
} from "@/lib/windsor/report";
import {
  CAMPAIGN_METRIC_COLUMNS,
  defaultCampaignColumns,
  type CampaignMetricColumn,
  type DashboardModel,
} from "@/lib/windsor/types";
import { clientCanViewIntegration } from "@/lib/integrations/access";

export const dynamic = "force-dynamic";
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const querySchema = z.object({
  from: z.string().regex(datePattern),
  to: z.string().regex(datePattern),
}).superRefine((value, context) => {
  const from = new Date(`${value.from}T00:00:00Z`);
  const to = new Date(`${value.to}T00:00:00Z`);
  const days = (to.getTime() - from.getTime()) / 86_400_000;
  if (days < 0 || days > 92) context.addIssue({ code: "custom", message: "Período deve ter até 92 dias." });
});
const columnsSchema = z.object({
  columns: z.array(z.enum(CAMPAIGN_METRIC_COLUMNS)).min(1).max(CAMPAIGN_METRIC_COLUMNS.length)
    .refine((columns) => new Set(columns).size === columns.length, "Colunas duplicadas."),
});

function validColumns(value: unknown, model: DashboardModel): CampaignMetricColumn[] {
  const parsed = z.array(z.enum(CAMPAIGN_METRIC_COLUMNS)).safeParse(value);
  return parsed.success && parsed.data.length > 0 ? parsed.data : defaultCampaignColumns(model);
}

export async function GET(request: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "reports" });
  if (!authz.ok) return authz.response;
  const params = new URL(request.url).searchParams;
  const parsed = querySchema.safeParse({ from: params.get("from"), to: params.get("to") });
  if (!parsed.success) {
    return fail("validation_error", "Período inválido.", 400, { requestId, details: parsed.error.flatten() });
  }
  const admin = createAdminClient();
  const organizationId = authz.org.orgId;
  if (
    !(authz.user.is_platform_admin && !authz.user.support) &&
    !(await clientCanViewIntegration(admin, organizationId, "windsor"))
  ) return fail("forbidden", "Relatório não liberado para esta organização.", 403, { requestId });
  const { data: config, error: configError } = await admin.from("traffic_dashboard_configs" as never)
    .select("model,conversion_fields,sync_status,last_sync_succeeded_at,last_sync_error,published_generation,campaign_metric_columns")
    .eq("organization_id", organizationId).eq("enabled", true).maybeSingle();
  if (configError) return fail("internal_error", "Não foi possível ler o relatório.", 500, { requestId });
  if (!config) return fail("not_found", "Dashboard nativo não configurado.", 404, { requestId });

  const typedConfig = config as unknown as {
    model: DashboardModel; conversion_fields: string[]; sync_status: string;
    last_sync_succeeded_at: string | null; last_sync_error: string | null;
    published_generation: string | null;
    campaign_metric_columns: unknown;
  };
  const fromCreatedAt = `${parsed.data.from}T00:00:00.000Z`;
  const exclusiveTo = new Date(`${parsed.data.to}T00:00:00.000Z`);
  exclusiveTo.setUTCDate(exclusiveTo.getUTCDate() + 1);
  const [
    { data: accounts, error: accountError },
    factsResult,
    { data: wonStages, error: wonStagesError },
    { count: crmLeadsEntered, error: crmLeadsError },
  ] = await Promise.all([
    admin.from("traffic_dashboard_accounts" as never)
      .select("account_id,account_name,platform,currency").eq("organization_id", organizationId),
    typedConfig.published_generation
      ? admin.from("traffic_dashboard_facts" as never)
        .select("account_id,platform,occurred_on,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,impressions,reach,clicks,link_clicks,spend,conversions,revenue,video_views,video_p25,video_p50,video_p75,video_p95,thumbnail_url,story_id")
        .eq("organization_id", organizationId)
        .eq("sync_generation", typedConfig.published_generation)
        .gte("occurred_on", parsed.data.from).lte("occurred_on", parsed.data.to).order("occurred_on")
      : Promise.resolve({ data: [], error: null }),
    admin.from("crm_stages" as never)
      .select("id")
      .eq("organization_id", organizationId)
      .eq("is_won", true),
    admin.from("crm_leads" as never)
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .gte("created_at", fromCreatedAt)
      .lt("created_at", exclusiveTo.toISOString()),
  ]);
  const factError = factsResult.error;
  if (accountError || factError || wonStagesError || crmLeadsError) {
    return fail("internal_error", "Não foi possível ler o relatório.", 500, { requestId });
  }
  const wonStageIds = ((wonStages ?? []) as unknown as Array<{ id: string }>).map(
    (stage) => stage.id,
  );
  let crmClosedWon = 0;
  if (wonStageIds.length > 0) {
    const { count, error } = await admin.from("crm_leads" as never)
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .gte("created_at", fromCreatedAt)
      .lt("created_at", exclusiveTo.toISOString())
      .in("stage_id", wonStageIds);
    if (error) {
      return fail("internal_error", "Não foi possível ler o relatório.", 500, { requestId });
    }
    crmClosedWon = count ?? 0;
  }
  const crmEntered = crmLeadsEntered ?? 0;
  const facts = factsResult.data;
  const storedAccounts = (accounts ?? []) as unknown as StoredAccount[];
  const campaignReach = new Map<string, number>();
  await Promise.all(storedAccounts
    .filter((account) => account.platform === "meta_ads")
    .map(async (account) => {
      try {
        const rows = await fetchWindsorCampaignReach(account.account_id, parsed.data);
        for (const row of rows) {
          const campaignId = typeof row.campaign_id === "string" ? row.campaign_id : null;
          const campaignName = typeof row.campaign === "string" ? row.campaign : "";
          const reach = Number(row.reach ?? 0);
          if (!Number.isFinite(reach) || reach <= 0) continue;
          const key = campaignReportKey("meta_ads", campaignId, campaignName);
          campaignReach.set(key, reach);
        }
      } catch {
        // O relatório continua disponível; alcance fica indisponível se o conector falhar.
      }
    }));
  return ok({
    model: typedConfig.model,
    organization_key: organizationId,
    viewer_key: authz.user.id,
    default_columns: validColumns(typedConfig.campaign_metric_columns, typedConfig.model),
    can_manage_defaults: authz.user.is_platform_admin && !authz.user.support,
    sync: {
      status: typedConfig.sync_status,
      last_succeeded_at: typedConfig.last_sync_succeeded_at,
      error: typedConfig.last_sync_error,
    },
    window: { from: parsed.data.from, to: parsed.data.to },
    crm: {
      leads_entered: crmEntered,
      in_service: Math.max(0, crmEntered - crmClosedWon),
      closed_won: crmClosedWon,
    },
    currencies: buildTrafficReport({
      model: typedConfig.model,
      conversionFields: typedConfig.conversion_fields,
      accounts: storedAccounts,
      facts: (facts ?? []) as unknown as StoredFact[],
      campaignReach,
    }),
  }, { requestId });
}

export async function PATCH(request: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "reports" });
  if (!authz.ok) return authz.response;
  if (!authz.user.is_platform_admin || authz.user.support) {
    return fail("forbidden", "Apenas o admin da plataforma pode alterar o padrão.", 403, { requestId });
  }
  const parsed = columnsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_error", "Colunas inválidas.", 400, {
      requestId,
      details: parsed.error.flatten(),
    });
  }
  const organizationId = authz.org.orgId;
  const admin = createAdminClient();
  const { error } = await admin.from("traffic_dashboard_configs" as never)
    .update({ campaign_metric_columns: parsed.data.columns } as never)
    .eq("organization_id", organizationId)
    .eq("enabled", true);
  if (error) {
    return fail("internal_error", "Não foi possível salvar o padrão de colunas.", 500, { requestId });
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
