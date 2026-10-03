import { randomUUID } from "node:crypto";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function POST(_req: Request, ctx: RouteCtx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "contact" });
  if (!authz.ok) return authz.response;
  const { user, org } = authz;
  const { id } = await ctx.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return fail("validation_failed", "Identificador de junção inválido.", 422, { requestId });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "fn_desfazer_mesclagem_automatica_whatsapp" as never,
    { p_organization_id: org.orgId, p_merge_queue_id: id } as never,
  );
  if (error) {
    const conflito = /historico_mudou|estado_da_mesclagem|nao_pode_ser_desfeita/.test(
      error.message ?? "",
    );
    return fail(
      conflito ? "state_conflict" : "internal_error",
      conflito
        ? "A junção não pode mais ser desfeita automaticamente porque o histórico mudou."
        : error.message,
      conflito ? 409 : 500,
      { requestId },
    );
  }

  const resultado = data as unknown as {
    outcome: string;
    whatsapp_contact_id?: string;
    form_contact_id?: string;
  };
  await audit({
    action: "contact.merge_undone",
    actorUserId: user.id,
    organizationId: org.orgId,
    resourceType: "contact_merge",
    resourceId: id,
    requestId,
    metadata: {
      whatsapp_contact_id: resultado.whatsapp_contact_id,
      form_contact_id: resultado.form_contact_id,
    },
  });
  return ok(resultado, { requestId });
}
