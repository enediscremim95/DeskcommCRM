/**
 * GET/POST /api/v1/admin/tenants/[id]/template — aplicar um template de nicho.
 *
 * GET devolve o catálogo e o que já foi aplicado nesta organização. POST aplica.
 *
 * O conteúdo do template vem de `lib/templates/organizacao/`, que é código
 * versionado, e NUNCA de outra organização: esta rota não tem um `select` que
 * leia tenant diferente do que está na URL. Ver o cabeçalho da migration 0233
 * para o porquê de não ser "clonar organização".
 *
 * Requer platform admin com escopo completo e MFA em dia — é a mesma porta por
 * onde se cria organização, porque aplicar template reescreve o funil de um
 * cliente.
 */
import { type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { requireSupportWrite } from "@/lib/impersonate/support";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { mfaEmDivida } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { TEMPLATES, acharTemplate } from "@/lib/templates/organizacao/catalogo";
import { payloadDoTemplate } from "@/lib/templates/organizacao/aplicacao";

const bodySchema = z.object({ template_id: z.string().min(1).max(40) });

/** As recusas da função do banco, ditas para quem opera a plataforma. */
function explicarRecusa(motivo: string | undefined, quantos: number | undefined): string {
  switch (motivo) {
    case "organizacao_nao_encontrada":
      return "Organização não encontrada, ou foi anonimizada por pedido de LGPD.";
    case "funil_nao_encontrado":
      return "Esta organização não tem funil padrão. Sem ele não há onde aplicar as etapas.";
    case "funil_com_negocios":
      return (
        `O funil desta organização já tem ${quantos ?? "alguns"} negócio(s) dentro. ` +
        "Trocar as colunas agora deixaria eles sem lugar, então o template não foi aplicado. " +
        "Templates são para organização nova."
      );
    case "etapa_em_uso_por_webhook":
      return (
        "Uma etapa do funil atual é o destino de uma integração que traz leads de fora. " +
        "Trocar as colunas desligaria essa integração em silêncio, então o template não foi aplicado."
      );
    default:
      return "Não foi possível aplicar o template agora.";
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = randomUUID();
  const { id: tenantId } = await params;

  try {
    await requirePlatformAdmin();
  } catch {
    return fail("forbidden", "Platform admin required", 403, { requestId });
  }

  const admin = createAdminClient();
  const { data: org, error } = await admin
    .from("organizations")
    .select("id, settings")
    .eq("id", tenantId)
    .maybeSingle();

  if (error || !org) return fail("not_found", "Tenant not found", 404, { requestId });

  const settings = (org.settings as Record<string, unknown> | null) ?? {};

  return ok(
    {
      // Só o que a tela precisa mostrar. O conteúdo inteiro do template (prompt,
      // textos das cadências) não viaja: é grande e a tela não o exibe.
      catalogo: TEMPLATES.map((t) => ({
        id: t.id,
        nome: t.nome,
        para_quem: t.paraQuem,
        quantas_respostas: t.respostasRapidas.length,
        quantas_cadencias: t.cadencias.length,
        quantos_campos: t.campos.length,
      })),
      aplicado: settings.template_aplicado ?? null,
    },
    { requestId },
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: tenantId } = await params;

  const supportDenied = await requireSupportWrite(tenantId);
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();

  let adminCtx: Awaited<ReturnType<typeof requirePlatformAdmin>>;
  try {
    adminCtx = await requirePlatformAdmin();
  } catch {
    return fail("forbidden", "Platform admin required", 403, { requestId });
  }

  if (adminCtx.platformAdmin.scope !== "full") {
    return fail("forbidden", "Seu acesso de suporte não permite aplicar templates", 403, {
      requestId,
    });
  }
  if (await mfaEmDivida()) {
    return fail("mfa_required", "Confirme a verificação em duas etapas", 403, { requestId });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return fail("validation_failed", "Invalid request body", 400, { requestId });
  }

  const template = acharTemplate(body.template_id);
  if (!template) {
    return fail("validation_failed", "Template desconhecido", 400, { requestId });
  }

  const admin = createAdminClient();

  const { data: org, error: orgError } = await admin
    .from("organizations")
    .select("id, slug, status")
    .eq("id", tenantId)
    .maybeSingle();

  if (orgError || !org) return fail("not_found", "Tenant not found", 404, { requestId });
  if (org.status !== "active") {
    return fail("state_conflict", "Organização não está ativa", 409, { requestId });
  }

  // Os slugs de funil em uso NESTA organização — `uniq_crm_pipelines_org_slug` é
  // por organização, então é aqui que se descobre se "Interessados" já virou
  // `interessados` em outro funil do mesmo cliente.
  const { data: funis } = await admin
    .from("crm_pipelines")
    .select("slug, is_default")
    .eq("organization_id", tenantId);

  const slugsEmUso = (funis ?? [])
    .filter((f) => !f.is_default)
    .map((f) => String(f.slug ?? ""));

  const payload = payloadDoTemplate(template, slugsEmUso);

  const { data: resposta, error } = await admin.rpc("fn_aplicar_template_de_organizacao", {
    p_organization_id: tenantId,
    p_actor: adminCtx.user.id,
    p_payload: payload,
  });

  if (error) {
    return fail("internal_error", "Não foi possível aplicar o template", 500, {
      requestId,
      details: error.message,
    });
  }

  const r = (resposta ?? {}) as {
    ok?: boolean;
    motivo?: string;
    quantos?: number;
    etapas?: number;
    respostas_criadas?: number;
    cadencias_criadas?: number;
    atendente_aplicado?: boolean;
    respostas_preservadas?: number;
    cadencias_preservadas?: number;
    regras_da_casa_preservadas?: boolean;
    atendente_preservado?: boolean;
    estado_hibrido?: boolean;
  };

  if (!r.ok) {
    // 409 e não 500: as recusas são estados legítimos da organização, não falha
    // do servidor. A tela mostra a frase; o operador decide o que fazer.
    return fail("state_conflict", explicarRecusa(r.motivo, r.quantos), 409, {
      requestId,
      details: r.motivo,
    });
  }

  void audit({
    action: "tenant.template_applied",
    actorUserId: adminCtx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    organizationId: tenantId,
    resourceType: "organization",
    resourceId: tenantId,
    requestId,
    metadata: {
      template_id: template.id,
      tenant_slug: org.slug,
      etapas: r.etapas ?? 0,
      respostas_criadas: r.respostas_criadas ?? 0,
      cadencias_criadas: r.cadencias_criadas ?? 0,
      atendente_aplicado: r.atendente_aplicado ?? false,
      respostas_preservadas: r.respostas_preservadas ?? 0,
      cadencias_preservadas: r.cadencias_preservadas ?? 0,
      regras_da_casa_preservadas: r.regras_da_casa_preservadas ?? false,
      atendente_preservado: r.atendente_preservado ?? false,
      estado_hibrido: r.estado_hibrido ?? false,
    },
  });

  return ok(
    {
      template_id: template.id,
      etapas: r.etapas ?? 0,
      respostas_criadas: r.respostas_criadas ?? 0,
      cadencias_criadas: r.cadencias_criadas ?? 0,
      atendente_aplicado: r.atendente_aplicado ?? false,
      respostas_preservadas: r.respostas_preservadas ?? 0,
      cadencias_preservadas: r.cadencias_preservadas ?? 0,
      regras_da_casa_preservadas: r.regras_da_casa_preservadas ?? false,
      atendente_preservado: r.atendente_preservado ?? false,
      estado_hibrido: r.estado_hibrido ?? false,
    },
    { requestId },
  );
}
