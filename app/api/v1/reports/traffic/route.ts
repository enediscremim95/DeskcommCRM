import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildTrafficReport, type StoredAccount, type StoredFact } from "@/lib/windsor/report";
import type { DashboardModel } from "@/lib/windsor/types";

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
  const { data: config, error: configError } = await admin.from("traffic_dashboard_configs" as never)
    .select("model,conversion_fields,sync_status,last_sync_succeeded_at,last_sync_error,published_generation")
    .eq("organization_id", organizationId).eq("enabled", true).maybeSingle();
  if (configError) return fail("internal_error", "Não foi possível ler o relatório.", 500, { requestId });
  if (!config) return fail("not_found", "Dashboard nativo não configurado.", 404, { requestId });

  const typedConfig = config as unknown as {
    model: DashboardModel; conversion_fields: string[]; sync_status: string;
    last_sync_succeeded_at: string | null; last_sync_error: string | null;
    published_generation: string | null;
  };
  const [{ data: accounts, error: accountError }, factsResult] = await Promise.all([
    admin.from("traffic_dashboard_accounts" as never)
      .select("account_id,account_name,platform,currency").eq("organization_id", organizationId),
    typedConfig.published_generation
      ? admin.from("traffic_dashboard_facts" as never)
        .select("account_id,platform,occurred_on,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,impressions,reach,clicks,link_clicks,spend,conversions,revenue,video_views,video_p25,video_p50,video_p75,video_p95,thumbnail_url,story_id")
        .eq("organization_id", organizationId)
        .eq("sync_generation", typedConfig.published_generation)
        .gte("occurred_on", parsed.data.from).lte("occurred_on", parsed.data.to).order("occurred_on")
      : Promise.resolve({ data: [], error: null }),
  ]);
  const factError = factsResult.error;
  if (accountError || factError) {
    return fail("internal_error", "Não foi possível ler o relatório.", 500, { requestId });
  }
  const facts = factsResult.data;
  return ok({
    model: typedConfig.model,
    sync: {
      status: typedConfig.sync_status,
      last_succeeded_at: typedConfig.last_sync_succeeded_at,
      error: typedConfig.last_sync_error,
    },
    window: { from: parsed.data.from, to: parsed.data.to },
    currencies: buildTrafficReport({
      model: typedConfig.model,
      conversionFields: typedConfig.conversion_fields,
      accounts: (accounts ?? []) as unknown as StoredAccount[],
      facts: (facts ?? []) as unknown as StoredFact[],
    }),
  }, { requestId });
}
