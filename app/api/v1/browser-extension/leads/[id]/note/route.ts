import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { autenticarExtensao } from "@/lib/browser-extension/auth";
import { comCorsDaExtensao, respostaPreflightDaExtensao } from "@/lib/browser-extension/cors";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { requireSupportWrite } from "@/lib/impersonate/support";

const schema = z.object({ body: z.string().trim().min(1).max(2000) });
export const dynamic = "force-dynamic";
export const OPTIONS = respostaPreflightDaExtensao;

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return comCorsDaExtensao(supportDenied);
  const authn = await autenticarExtensao(req, "agent");
  if (!authn.ok) return comCorsDaExtensao(authn.response);
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return comCorsDaExtensao(fail("validation_failed", "Anotação inválida.", 422, { requestId }));
  const { id } = await ctx.params;
  const { admin, organizationId, userId } = authn.auth;
  const { data: lead } = await admin
    .from("crm_leads")
    .select("id, contact_id")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!lead?.contact_id)
    return comCorsDaExtensao(fail("not_found", "Lead não encontrado.", 404, { requestId }));
  const { data: note, error } = await admin
    .from("lead_notes")
    .insert({
      organization_id: organizationId,
      contact_id: lead.contact_id,
      headline: "Anotação do atendimento",
      body: parsed.data.body,
    })
    .select("id, headline, body, created_at")
    .single();
  if (error || !note)
    return comCorsDaExtensao(
      fail("internal_error", "Erro ao salvar a anotação.", 500, { requestId }),
    );
  await emitLeadActivity(admin, {
    organizationId,
    leadId: id,
    contactId: lead.contact_id,
    type: "note",
    sourceModule: "browser_extension",
    sourceId: note.id,
    actor: { type: "user", id: userId },
    reason: "Anotação adicionada no apoio do WhatsApp Web",
  });
  void audit({
    action: "lead.updated",
    actorUserId: userId,
    organizationId,
    resourceType: "crm_lead",
    resourceId: id,
    requestId,
    metadata: { source: "browser_extension", change: "note_added" },
  });
  return comCorsDaExtensao(ok(note, { requestId, status: 201 }));
}
