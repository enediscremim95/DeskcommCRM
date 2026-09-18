import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { DASHBOARD_MODELS } from "@/lib/windsor/types";

export const dynamic = "force-dynamic";
const idSchema = z.string().uuid();
const conversionField = z.string().trim().min(2).max(160)
  .regex(/^(actions_[\p{L}\p{N}_]+|conversions)$/u);
const inputSchema = z.object({
  model: z.enum(DASHBOARD_MODELS),
  conversion_fields: z.array(conversionField).min(1).max(2),
  revenue_field: z.enum(["action_values_purchase", "conversion_value"]).nullable().optional(),
  accounts: z.array(z.object({
    account_id: z.string().trim().min(1).max(128),
    platform: z.enum(["meta_ads", "google_ads"]),
    account_name: z.string().trim().min(1).max(240),
    currency: z.string().regex(/^[A-Z]{3}$/),
  })).min(1).max(100),
});

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();
  try { await requirePlatformAdmin(); } catch {
    return fail("forbidden", "Platform admin required", 403, { requestId });
  }
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) return fail("validation_error", "Organização inválida.", 400, { requestId });
  const admin = createAdminClient();
  const [{ data: config, error: configError }, { data: accounts, error: accountsError }] = await Promise.all([
    admin.from("traffic_dashboard_configs" as never).select("*").eq("organization_id", id).maybeSingle(),
    admin.from("traffic_dashboard_accounts" as never).select("account_id,platform,account_name,currency")
      .eq("organization_id", id).order("account_name"),
  ]);
  if (configError || accountsError) {
    return fail("internal_error", configError?.message ?? accountsError?.message ?? "Falha de leitura.", 500, { requestId });
  }
  return ok({ config, accounts: accounts ?? [] }, { requestId });
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  let adminContext: Awaited<ReturnType<typeof requirePlatformAdmin>>;
  try { adminContext = await requirePlatformAdmin(); } catch {
    return fail("forbidden", "Platform admin required", 403, { requestId });
  }
  const { id } = await context.params;
  const parsedId = idSchema.safeParse(id);
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsedId.success || !parsed.success) {
    return fail("validation_error", "Configuração inválida.", 400, {
      requestId, details: parsed.success ? undefined : parsed.error.flatten(),
    });
  }
  const admin = createAdminClient();
  const { error } = await admin.rpc("fn_configure_traffic_dashboard" as never, {
    p_organization_id: id,
    p_actor: adminContext.user.id,
    p_model: parsed.data.model,
    p_conversion_fields: parsed.data.conversion_fields,
    p_revenue_field: parsed.data.model === "ecommerce" ? (parsed.data.revenue_field ?? "action_values_purchase") : null,
    p_accounts: parsed.data.accounts,
  } as never);
  if (error) return fail("internal_error", "Não foi possível salvar o dashboard.", 500, { requestId });
  await audit({
    action: "traffic_dashboard.configuration_updated",
    actorUserId: adminContext.user.id,
    organizationId: id,
    resourceType: "traffic_dashboard_config",
    resourceId: id,
    requestId,
    bypassedRls: true,
    actingAsPlatformAdmin: true,
    metadata: {
      model: parsed.data.model,
      account_ids: parsed.data.accounts.map((account) => account.account_id),
      conversion_fields: parsed.data.conversion_fields,
    },
  });
  return ok({ saved: true }, { requestId });
}
