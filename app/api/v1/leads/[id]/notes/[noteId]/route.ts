import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { fail, noContent } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { roleAtLeast } from "@/lib/auth/types";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { traduzir } from "@/lib/i18n/dicionario";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; noteId: string }> },
): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = req.headers.get("x-request-id")?.trim() || randomUUID();
  const { id: leadId, noteId } = await ctx.params;
  const authz = await requireRole("agent", {
    requestId,
    resource: "crm_lead_notes",
    allowPlatformAdmin: true,
  });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const supabase = await createClient();

  // Primeiro prova o escopo do lead pela RLS. Um UUID de outra organização ou
  // de outro atendente responde 404 sem revelar que o negócio existe.
  const { data: lead, error: leadError } = await supabase
    .from("crm_leads")
    .select("id")
    .eq("id", leadId)
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();
  if (leadError)
    return fail("internal_error", t("Erro ao localizar o negócio."), 500, { requestId });
  if (!lead) return fail("not_found", t("Negócio não encontrado."), 404, { requestId });

  const { data: note, error: noteError } = await supabase
    .from("crm_lead_activities")
    .select("id, performed_by_user_id")
    .eq("id", noteId)
    .eq("lead_id", leadId)
    .eq("organization_id", authz.org.orgId)
    .eq("type", "note")
    .maybeSingle();
  if (noteError)
    return fail("internal_error", t("Erro ao localizar a anotação."), 500, { requestId });
  if (!note) return fail("not_found", t("Anotação não encontrada."), 404, { requestId });

  const platformAdmin = authz.user.is_platform_admin && !authz.user.support;
  const podeApagar =
    note.performed_by_user_id === authz.user.id ||
    roleAtLeast(authz.org.role, "manager") ||
    platformAdmin;
  if (!podeApagar) {
    return fail("forbidden", t("Você não pode apagar esta anotação."), 403, { requestId });
  }

  const { data: deleted, error } = await supabase
    .from("crm_lead_activities")
    .delete()
    .eq("id", noteId)
    .eq("lead_id", leadId)
    .eq("organization_id", authz.org.orgId)
    .eq("type", "note")
    .select("id")
    .maybeSingle();
  if (error) return fail("internal_error", t("Erro ao apagar anotação."), 500, { requestId });
  if (!deleted) return fail("not_found", t("Anotação não encontrada."), 404, { requestId });

  void audit({
    action: "lead.note_deleted",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "crm_lead_activity",
    resourceId: noteId,
    requestId,
    metadata: { lead_id: leadId },
  });

  return noContent(requestId);
}
