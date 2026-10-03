import { randomUUID } from "node:crypto";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import {
  erroPrevistoDaJuncao,
  type ResultadoJuncaoDeNegocios,
} from "@/lib/leads/negocios-duplicados";
import { createClient } from "@/lib/supabase/server";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const paramsSchema = z.object({ id: z.string().uuid() }).strict();

export async function POST(_req: Request, context: RouteContext): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "crm_lead" });
  if (!authz.ok) return authz.response;
  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) {
    return fail("validation_failed", "Identificador de junção inválido.", 422, { requestId });
  }
  const { id } = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "fn_desfazer_juncao_de_negocios" as never,
    { p_organization_id: authz.org.orgId, p_log_id: id } as never,
  );
  if (error) {
    const previsto = erroPrevistoDaJuncao(error.message);
    return fail(
      previsto?.code ?? "internal_error",
      previsto?.message ?? error.message,
      previsto?.status ?? 500,
      { requestId },
    );
  }

  const resultado = data as unknown as ResultadoJuncaoDeNegocios;
  if (resultado.outcome === "undone") {
    await audit({
      action: "lead.duplicate_merge_undone",
      actorUserId: authz.user.id,
      organizationId: authz.org.orgId,
      resourceType: "crm_lead_merge",
      resourceId: resultado.log_id,
      requestId,
      metadata: {
        survivor_lead_id: resultado.survivor_lead_id,
        restored_lead_id: resultado.absorbed_lead_id,
        outcome: resultado.outcome,
      },
    });
  }
  return ok(resultado, { requestId });
}
