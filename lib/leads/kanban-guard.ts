/**
 * Guarda ÚNICO do Kanban — regra de 16/11/2026 (Enedi), igual para todas as organizações.
 *
 * - Humano move livremente (qualquer direção, inclusive sair de Ganho/Perdido).
 * - IA, automações, webhooks e integrações (qualquer ator que não seja `user`) só podem
 *   mover o negócio PARA A FRENTE, pela posição da etapa, dentro do mesmo funil, e só
 *   quando o chamador tem um motivo real de avanço (passo do agente, agendamento,
 *   handoff, regra configurada). Nunca para trás, nunca para a mesma posição, nunca de
 *   volta à primeira etapa por mensagem recebida, nunca para dentro ou para fora de
 *   etapa final (Ganho/Perdido). Ganhar/perder segue exclusivo de humano.
 *
 * Esta função é pura e é a ÚNICA fonte da regra: `moveLeadHandler` (REST/MCP/automação),
 * `agent-stage-sync`, `handoff-stage-move` e `appointment-stage-move` a chamam. O trigger
 * `fn_guard_kanban_human` (migration 0312) repete a mesma regra no banco para JWT de serviço.
 */
import type { HandlerCtx } from "@/lib/api/handlers/types";
import { ApiError } from "@/lib/api/types";

export interface EtapaDoGuarda {
  id: string;
  pipeline_id?: string | null;
  position: number;
  is_won?: boolean | null;
  is_lost?: boolean | null;
  is_archived?: boolean | null;
}

export type MotivoDeRecusa =
  | "ja_esta_la"
  | "etapa_final_so_humano"
  | "so_avanca"
  | "outro_funil"
  | "etapa_arquivada";

export type VeredictoDoKanban =
  | { permitido: true }
  | { permitido: false; motivo: MotivoDeRecusa };

const final = (e: EtapaDoGuarda) => Boolean(e.is_won || e.is_lost);

/** Decide se um ator AUTOMÁTICO pode ir de `de` para `para`. Humano não passa por aqui. */
export function avaliaMovimentoAutomatico(de: EtapaDoGuarda, para: EtapaDoGuarda): VeredictoDoKanban {
  if (de.id === para.id) return { permitido: false, motivo: "ja_esta_la" };
  if (final(de) || final(para)) return { permitido: false, motivo: "etapa_final_so_humano" };
  if (de.pipeline_id && para.pipeline_id && de.pipeline_id !== para.pipeline_id)
    return { permitido: false, motivo: "outro_funil" };
  if (para.is_archived) return { permitido: false, motivo: "etapa_arquivada" };
  if (!(Number(para.position) > Number(de.position))) return { permitido: false, motivo: "so_avanca" };
  return { permitido: true };
}

/** Ator humano = sessão de usuário. Todo o resto (IA, webhook, bearer de integração) é automático. */
export function atorEhHumano(ctx: Pick<HandlerCtx, "actor">): boolean {
  return ctx.actor.type === "user";
}

const TEXTO: Record<MotivoDeRecusa, string> = {
  ja_esta_la: "O negócio já está nesta etapa.",
  etapa_final_so_humano: "Somente uma pessoa pode mover um negócio para ou a partir de Ganho/Perdido.",
  so_avanca: "A IA e as automações só podem avançar o negócio no funil, nunca voltá-lo de etapa.",
  outro_funil: "A IA e as automações não movem o negócio para outro funil.",
  etapa_arquivada: "A etapa de destino está arquivada.",
};

/** Para handlers: humano passa; automático precisa de avanço válido, senão 403. */
export function exigeMovimentoPermitido(
  ctx: HandlerCtx,
  de: EtapaDoGuarda,
  para: EtapaDoGuarda,
): void {
  if (atorEhHumano(ctx)) return;
  const v = avaliaMovimentoAutomatico(de, para);
  if (!v.permitido)
    throw new ApiError(403, "forbidden", { reason: v.motivo }, ctx.requestId, TEXTO[v.motivo]);
}
