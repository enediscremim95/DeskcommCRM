import { type NextRequest } from "next/server";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import type { AuditAction } from "@/lib/audit/actions";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { WHATSAPP_MEDIA_STORAGE_SETTING } from "@/lib/messaging/media/retention";

const tenantPatchSchema = z.union([
  z.object({ report_url: z.string().url().startsWith("https://").nullable() }).strict(),
  z.object({ whatsapp_media_storage_enabled: z.boolean() }).strict(),
]);

export function mesclarConfiguracaoDeMidia(
  settings: unknown,
  enabled: boolean,
): Record<string, unknown> {
  const current = settings && typeof settings === "object" && !Array.isArray(settings)
    ? settings as Record<string, unknown>
    : {};
  return { ...current, [WHATSAPP_MEDIA_STORAGE_SETTING]: enabled };
}

// ---------------------------------------------------------------------------
// GET /api/v1/admin/tenants/[id]
// ---------------------------------------------------------------------------

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = randomUUID();
  const { id } = await params;

  let adminCtx: Awaited<ReturnType<typeof requirePlatformAdmin>>;
  try {
    adminCtx = await requirePlatformAdmin();
  } catch {
    return fail("forbidden", "Platform admin required", 403, { requestId });
  }

  const admin = createAdminClient();

  // Load the organization (service-role bypasses RLS — intentional cross-tenant)
  const { data: org, error: orgError } = await admin
    .from("organizations")
    .select(
      `
      id,
      slug,
      display_name,
      legal_name,
      cnpj,
      report_url,
      status,
      onboarded_at,
      suspended_at,
      created_at,
      settings
    `,
    )
    .eq("id", id)
    .single();

  if (orgError || !org) {
    return fail("not_found", "Tenant not found", 404, { requestId });
  }

  // Run counts in parallel — service role, all cross-tenant reads are intentional
  const [
    usersRes,
    conversationsRes,
    messagesRes,
    leadsRes,
    ordersRes,
    lgpdRes,
    aiRes,
    wahaRes,
    integrationRes,
  ] = await Promise.all([
    admin
      .from("user_organizations")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", id),
    admin
      .from("conversations")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", id),
    admin
      .from("messages")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", id),
    admin
      .from("crm_leads")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", id),
    admin
      .from("orders")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", id),
    admin
      .from("lgpd_requests")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", id)
      // `pending` não existe em `lgpd_requests_status_check`
      // (received/processing/completed/failed/expired), então este contador era
      // sempre 0 e a tela jurava que o tenant não devia nada à LGPD. Aqui
      // pendente = TUDO que ainda não fechou, sem recorte de prazo. O KPI de
      // plataforma (`app/api/v1/admin/dashboard/kpis/route.ts`) parte do mesmo
      // "não fechado" mas soma só o que vence nos próximos 5 dias — os dois
      // números divergem de propósito: este é o total do tenant, aquele é a
      // fila de SLA da plataforma.
      .not("status", "in", "(completed,failed)"),
    // `llm_calls` e não `ai_invocations`: a migration 0130 deixou a segunda sem
    // nenhum escritor (`lib/ai/log-invocation.ts` passou a gravar na primeira).
    // Lendo a tabela morta, este contador viraria ZERO em 30 dias para todo
    // tenant — com o dinheiro saindo. É o mesmo sintoma que a 0130 veio matar.
    admin
      .from("llm_calls")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", id)
      .gte(
        "created_at",
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      ),
    admin
      .from("channel_sessions")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", id),
    admin
      .from("tenant_integrations")
      // `connected_at` não existe: a linha passa a existir quando a integração
      // é conectada, então `created_at` é essa mesma data com o nome real.
      .select("id, provider, status, created_at")
      .eq("organization_id", id)
      .eq("provider", "nuvemshop")
      .limit(1),
  ]);

  const counts = {
    user_count: usersRes.count ?? 0,
    conversations_count: conversationsRes.count ?? 0,
    messages_count: messagesRes.count ?? 0,
    leads_count: leadsRes.count ?? 0,
    orders_count: ordersRes.count ?? 0,
    lgpd_requests_pending: lgpdRes.count ?? 0,
    ai_invocations_30d: aiRes.count ?? 0,
    waha_sessions_count: wahaRes.count ?? 0,
  };

  const nuvemshopIntegration =
    integrationRes.data && integrationRes.data.length > 0
      ? integrationRes.data[0]
      : null;

  const integrations = {
    nuvemshop_status: nuvemshopIntegration?.status ?? null,
    // Nome de SAÍDA preservado: é o que TenantOverview já lê. Só a coluna de
    // origem estava errada.
    nuvemshop_connected_at: nuvemshopIntegration?.created_at ?? null,
  };

  // Audit lightweight — fire-and-forget
  void audit({
    action: "platform_admin.tenant_viewed",
    actorUserId: adminCtx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    organizationId: id,
    resourceType: "organization",
    resourceId: id,
    requestId,
    metadata: { tenant_slug: org.slug },
  });

  return ok({ organization: org, counts, integrations }, { requestId });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Sessão de suporte é de LEITURA: quem entrou para diagnosticar não grava a
  // URL do relatório do cliente. Faltava desde que o PATCH nasceu, e quem
  // acusou foi `tests/unit/suporte-cobertura-de-efeitos.test.ts` — o gate
  // existe exatamente para o método novo que esquece a guarda.
  const supportDenied = await requireSupportWrite(id);
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  let adminCtx: Awaited<ReturnType<typeof requirePlatformAdmin>>;
  try { adminCtx = await requirePlatformAdmin(); } catch { return fail("forbidden", "Platform admin required", 403, { requestId }); }
  const parsed = tenantPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_error", "Configuração inválida", 400, { requestId, details: parsed.error.flatten() });
  const admin = createAdminClient();
  let patch: { report_url?: string | null; settings?: Record<string, unknown> };
  let action: AuditAction;
  let metadata: Record<string, unknown>;

  if ("report_url" in parsed.data) {
    patch = { report_url: parsed.data.report_url };
    action = "platform_admin.tenant_report_updated";
    metadata = { configured: !!parsed.data.report_url };
  } else {
    const { data: organization, error: loadError } = await admin
      .from("organizations")
      .select("settings")
      .eq("id", id)
      .maybeSingle();
    if (loadError) return fail("internal_error", "Não foi possível ler a configuração", 500, { requestId });
    if (!organization) return fail("not_found", "Tenant not found", 404, { requestId });
    patch = {
      settings: mesclarConfiguracaoDeMidia(
        organization.settings,
        parsed.data.whatsapp_media_storage_enabled,
      ),
    };
    action = "platform_admin.tenant_whatsapp_media_storage_updated";
    metadata = { enabled: parsed.data.whatsapp_media_storage_enabled };
  }

  const { data, error } = await admin
    .from("organizations")
    .update(patch)
    .eq("id", id)
    .select("id, settings, report_url")
    .maybeSingle();
  if (error) return fail("internal_error", "Não foi possível salvar a configuração", 500, { requestId });
  if (!data) return fail("not_found", "Tenant not found", 404, { requestId });
  void audit({ action, actorUserId: adminCtx.user.id, actingAsPlatformAdmin: true, bypassedRls: true, organizationId: id, resourceType: "organization", resourceId: id, requestId, metadata });
  return ok(data, { requestId });
}
