import type { SupabaseClient } from "@supabase/supabase-js";

import type { HandlerCtx } from "@/lib/api/handlers/types";
import { ApiError } from "@/lib/api/types";
import { audit } from "@/lib/audit";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { registraFalhaDeAtividade } from "@/lib/leads/activity-write-failure";

interface OpenStage {
  id: string;
  name: string;
  position: number;
}

export function escolheEtapaDeRetomada(
  stages: OpenStage[],
  priorStageId: unknown,
): OpenStage | null {
  return stages.find((stage) => stage.id === priorStageId) ?? stages[0] ?? null;
}

export async function reabreLead(
  supabase: SupabaseClient,
  ctx: HandlerCtx,
  leadId: string,
): Promise<Record<string, unknown>> {
  const { data: lead, error } = await supabase
    .from("crm_leads")
    .select("*")
    .eq("id", leadId)
    .eq("organization_id", ctx.organization_id)
    .maybeSingle();
  if (error) throw new ApiError(500, "internal_error", undefined, ctx.requestId, error.message);
  if (!lead) throw new ApiError(404, "not_found", undefined, ctx.requestId, "Lead não encontrado.");
  if (lead.status !== "lost") return lead as Record<string, unknown>;

  const { data: fechamento } = await supabase
    .from("crm_lead_activities")
    .select("payload")
    .eq("organization_id", ctx.organization_id)
    .eq("lead_id", leadId)
    .eq("type", "demand_closed")
    .order("performed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const priorStageId =
    fechamento?.payload && typeof fechamento.payload === "object"
      ? (fechamento.payload as Record<string, unknown>).from_stage_id
      : null;

  const { data: stages, error: stagesError } = await supabase
    .from("crm_stages")
    .select("id, name, position")
    .eq("organization_id", ctx.organization_id)
    .eq("pipeline_id", lead.pipeline_id)
    .eq("is_archived", false)
    .eq("is_won", false)
    .eq("is_lost", false)
    .order("position", { ascending: true });
  if (stagesError) {
    throw new ApiError(500, "internal_error", undefined, ctx.requestId, stagesError.message);
  }
  const stage = escolheEtapaDeRetomada(stages ?? [], priorStageId);
  if (!stage) {
    throw new ApiError(
      422,
      "validation_failed",
      undefined,
      ctx.requestId,
      "O funil não tem etapa aberta para retomar a negociação.",
    );
  }

  const { data: last } = await supabase
    .from("crm_leads")
    .select("position_in_stage")
    .eq("organization_id", ctx.organization_id)
    .eq("stage_id", stage.id)
    .order("position_in_stage", { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = last?.position_in_stage == null ? 1000 : Number(last.position_in_stage) + 1000;
  const { data: updated, error: updateError } = await supabase
    .from("crm_leads")
    .update({
      stage_id: stage.id,
      position_in_stage: position,
      lost_reason: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", leadId)
    .eq("organization_id", ctx.organization_id)
    .select("*")
    .single();
  if (updateError) {
    throw new ApiError(500, "internal_error", undefined, ctx.requestId, updateError.message);
  }

  const activity = await emitLeadActivity(supabase, {
    organizationId: ctx.organization_id,
    leadId,
    contactId: updated.contact_id,
    type: "lead_reactivated",
    sourceModule: "crm",
    sourceId: leadId,
    actor: ctx.actor,
    reason: `Negociação retomada na etapa ${stage.name}`,
    payload: { from_stage_id: lead.stage_id, to_stage_id: stage.id, to_stage_name: stage.name },
  });
  if (!activity.ok) {
    await registraFalhaDeAtividade(supabase, {
      organizationId: ctx.organization_id,
      leadId,
      tipo: "lead_reactivated",
      origem: "lib/leads/reabertura.reabreLead",
      erro: activity.error,
      requestId: ctx.requestId,
    });
  }
  await audit({
    action: "lead.updated",
    actorUserId: ctx.actor.type === "user" ? ctx.actor.id : null,
    organizationId: ctx.organization_id,
    resourceType: "crm_lead",
    resourceId: leadId,
    requestId: ctx.requestId,
    metadata: { operation: "reopened", from_stage_id: lead.stage_id, to_stage_id: stage.id },
  });
  return updated as Record<string, unknown>;
}
