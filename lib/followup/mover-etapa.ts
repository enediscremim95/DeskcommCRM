/**
 * Ação "mover etapa" do fluxo de follow-up.
 *
 * NÃO tem regra própria de funil: delega para `moveLeadHandler` com um ator
 * automático, que passa pela guarda ÚNICA do Kanban (`lib/leads/kanban-guard.ts`)
 * e, no banco, pelo trigger `fn_guard_kanban_human` (0312). Logo: só avança,
 * nunca entra nem sai de Ganho/Perdido, nunca muda de funil.
 *
 * Toda recusa é NO-OP SEGURO, devolvida como `{ movido: false, motivo }` para
 * o engine gravar no passo — o fluxo segue. Só falha de infraestrutura (500)
 * lança, e aí o backoff do engine tenta de novo (mover de novo é inofensivo:
 * a segunda tentativa cai em `ja_esta_la`).
 *
 * ⚠️ O destino é resolvido DENTRO da organização do enrollment. Um `stage_id`
 * de outra organização é indistinguível de um id inexistente: `destino_invalido`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { moveLeadHandler } from "@/app/api/v1/leads/_handler";
import type { HandlerCtx } from "@/lib/api/handlers/types";
import { ApiError } from "@/lib/api/types";

export type MotivoMoverEtapa =
  | "sem_destino"
  | "destino_invalido"
  | "sem_negocio"
  | "ambiguo"
  | "ja_esta_la"
  | "etapa_final_so_humano"
  | "so_avanca"
  | "outro_funil"
  | "etapa_arquivada"
  | "conflito"
  | "recusado";

export type ResultadoMoverEtapa =
  | { movido: true; lead_id: string; to_stage_id: string }
  | { movido: false; motivo: MotivoMoverEtapa; lead_id?: string };

const MOTIVOS_DA_GUARDA = new Set<string>([
  "ja_esta_la",
  "etapa_final_so_humano",
  "so_avanca",
  "outro_funil",
  "etapa_arquivada",
]);

export async function moverEtapaDoFluxo(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    contactId: string;
    stageId: string | null | undefined;
    /** Correlação no audit/evento (`followup:<enrollment>:<passo>`). */
    requestId: string;
    /** Ator automático: o ponteiro do fluxo. */
    flowPointerId: string;
  },
  deps: { mover?: typeof moveLeadHandler } = {},
): Promise<ResultadoMoverEtapa> {
  if (!input.stageId) return { movido: false, motivo: "sem_destino" };
  const org = input.organizationId;

  const { data: etapa, error: eErr } = await admin
    .from("crm_stages")
    .select("id, pipeline_id")
    .eq("organization_id", org)
    .eq("id", input.stageId)
    .maybeSingle();
  if (eErr) throw new Error(eErr.message);
  if (!etapa) return { movido: false, motivo: "destino_invalido" };

  const { data: leads, error: lErr } = await admin
    .from("crm_leads")
    .select("id")
    .eq("organization_id", org)
    .eq("contact_id", input.contactId)
    .eq("pipeline_id", etapa.pipeline_id)
    .eq("status", "open")
    .limit(2);
  if (lErr) throw new Error(lErr.message);
  if (!leads || leads.length === 0) return { movido: false, motivo: "sem_negocio" };
  if (leads.length > 1) return { movido: false, motivo: "ambiguo" };
  const leadId = String(leads[0]!.id);

  const ctx: HandlerCtx = {
    organization_id: org,
    actor: { type: "webhook_source", id: input.flowPointerId },
    requestId: input.requestId,
  };
  try {
    await (deps.mover ?? moveLeadHandler)(admin, ctx, leadId, {
      to_stage_id: etapa.id,
      reason: "Fluxo de follow-up",
    });
    return { movido: true, lead_id: leadId, to_stage_id: etapa.id };
  } catch (err) {
    if (err instanceof ApiError && err.status < 500) {
      const motivo = (err.details as { reason?: string } | undefined)?.reason;
      if (motivo && MOTIVOS_DA_GUARDA.has(motivo)) {
        return { movido: false, motivo: motivo as MotivoMoverEtapa, lead_id: leadId };
      }
      if (err.status === 409) return { movido: false, motivo: "conflito", lead_id: leadId };
      return { movido: false, motivo: "recusado", lead_id: leadId };
    }
    // Trigger do banco (`kanban_only_forward`) chega como erro do PostgREST.
    const msg = err instanceof Error ? err.message : String(err);
    if (/kanban_only_forward/.test(msg)) return { movido: false, motivo: "so_avanca", lead_id: leadId };
    throw err;
  }
}
