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
 *
 * ⚠️ QUEM ESCOLHE O NEGÓCIO É A ORIGEM DO FLUXO, NUNCA O DESTINO. Antes o
 * negócio era achado pelo funil da etapa de destino — um fluxo que nasceu do
 * negócio do funil A, com destino configurado no funil B, movia o OUTRO negócio
 * do contato. Agora:
 *   1. `origemLeadId` (o `lead_id` gravado no evento de inscrição, ex.:
 *      `enrolled_by_stage_change`) manda: precisa ser da organização, do
 *      contato e estar aberto; destino em outro funil = `outro_funil`;
 *   2. sem origem, o contato precisa ter UM negócio na organização — contando
 *      qualquer situação, não só os abertos — e ele precisa estar aberto. Mais
 *      de um = `ambiguo`, no-op.
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
    /** Negócio que originou a inscrição (evento `enrolled_by_*`), quando houver. */
    origemLeadId?: string | null;
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

  let leadId: string;
  if (input.origemLeadId) {
    const { data: origem, error: oErr } = await admin
      .from("crm_leads")
      .select("id, pipeline_id, contact_id, status")
      .eq("organization_id", org)
      .eq("id", input.origemLeadId)
      .maybeSingle();
    if (oErr) throw new Error(oErr.message);
    if (!origem || origem.contact_id !== input.contactId || origem.status !== "open") {
      return { movido: false, motivo: "sem_negocio" };
    }
    if (origem.pipeline_id !== etapa.pipeline_id) {
      return { movido: false, motivo: "outro_funil", lead_id: String(origem.id) };
    }
    leadId = String(origem.id);
  } else {
    // Sem origem gravada, conta TODOS os negócios do contato, de qualquer
    // situação: se o de origem foi fechado (ou a proveniência não chegou a ser
    // gravada) e sobrou um único aberto de OUTRO funil, contar só os abertos
    // escolheria esse outro negócio. Mais de um negócio na vida do contato =
    // não há como saber qual é o do fluxo → no-op.
    const { data: leads, error: lErr } = await admin
      .from("crm_leads")
      .select("id, pipeline_id, status")
      .eq("organization_id", org)
      .eq("contact_id", input.contactId)
      .limit(2);
    if (lErr) throw new Error(lErr.message);
    if (!leads || leads.length === 0) return { movido: false, motivo: "sem_negocio" };
    if (leads.length > 1) return { movido: false, motivo: "ambiguo" };
    if (leads[0]!.status !== "open") return { movido: false, motivo: "sem_negocio" };
    if (leads[0]!.pipeline_id !== etapa.pipeline_id) {
      return { movido: false, motivo: "outro_funil", lead_id: String(leads[0]!.id) };
    }
    leadId = String(leads[0]!.id);
  }

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
