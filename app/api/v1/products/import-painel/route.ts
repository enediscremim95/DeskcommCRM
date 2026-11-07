import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { importarCatalogoDoPainel, retratoDoPainelSchema } from "@/lib/catalogo/importar-painel";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { traduzir } from "@/lib/i18n/dicionario";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** O painel não é chamado aqui. A rota recebe e aplica um retrato já exportado. */
export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "catalog_products" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const parsed = retratoDoPainelSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", t("Dados inválidos."), 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }
  try {
    const resumo = await importarCatalogoDoPainel(
      createAdminClient(),
      authz.org.orgId,
      parsed.data,
      { aplicar: true },
    );
    await audit({
      organizationId: authz.org.orgId,
      actorUserId: authz.user.id,
      action: "catalog_product.panel_imported",
      resourceType: "catalog_products",
      resourceId: null,
      requestId,
      metadata: {
        actor_type: "user",
        recebidos: parsed.data.produtos.length,
        criados: resumo.criados,
        atualizados: resumo.atualizados,
        desativados: resumo.desativados,
        fotos_novas: resumo.fotos_novas,
        falhas: resumo.falhas.length,
      },
    });
    return ok(resumo, { requestId });
  } catch {
    return fail("internal_error", t("Erro ao importar o catálogo."), 500, { requestId });
  }
}
