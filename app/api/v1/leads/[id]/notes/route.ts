import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { ApiError } from "@/lib/api/types";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { traduzir } from "@/lib/i18n/dicionario";
import type { ActivityType } from "@/lib/leads/activity-vocabulary";
import { TIMELINE_COLS } from "@/lib/leads/timeline-query";
import { validateRequest } from "@/lib/schemas";
import { createLeadNoteSchema, type CreateLeadNoteInput } from "@/lib/schemas/notes";
import { createClient } from "@/lib/supabase/server";
import type { TimelineItemView } from "@/lib/types/contacts";

export const dynamic = "force-dynamic";

const TIPO_ANOTACAO: ActivityType = "note";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = req.headers.get("x-request-id")?.trim() || randomUUID();
  const { id: leadId } = await ctx.params;
  const authz = await requireRole("agent", {
    requestId,
    resource: "crm_lead_notes",
    allowPlatformAdmin: true,
  });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  let input: CreateLeadNoteInput;
  try {
    input = await validateRequest(createLeadNoteSchema, req);
  } catch (error) {
    if (error instanceof ApiError) {
      return fail(error.code, error.message, error.status, {
        requestId,
        details: error.details,
      });
    }
    throw error;
  }

  const supabase = await createClient();
  // A leitura passa pela RLS do próprio usuário. Assim a org ativa não basta:
  // o atendente só anota um negócio que já está dentro do seu escopo.
  const { data: lead, error: leadError } = await supabase
    .from("crm_leads")
    .select("id, organization_id, contact_id")
    .eq("id", leadId)
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();
  if (leadError)
    return fail("internal_error", t("Erro ao localizar o negócio."), 500, { requestId });
  if (!lead) return fail("not_found", t("Negócio não encontrado."), 404, { requestId });

  const { data, error } = await supabase
    .from("crm_lead_activities")
    .insert({
      organization_id: authz.org.orgId,
      lead_id: leadId,
      contact_id: lead.contact_id,
      source_module: "crm",
      source_id: null,
      type: TIPO_ANOTACAO,
      payload: { text: input.text },
      actor_kind: "user",
      performed_by_user_id: authz.user.id,
      reason: null,
    })
    .select(TIMELINE_COLS)
    .single();
  if (error || !data) {
    return fail("internal_error", t("Erro ao criar anotação."), 500, { requestId });
  }

  const note: TimelineItemView = {
    ...(data as unknown as TimelineItemView),
    actor_user_name: authz.user.full_name,
  };
  void audit({
    action: "lead.note_created",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "crm_lead_activity",
    resourceId: note.id,
    requestId,
    metadata: { lead_id: leadId },
  });

  return ok(note, { status: 201, requestId });
}
