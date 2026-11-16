// Política 16/11/2026: IA/automação observa o funil; somente humanos movem cards.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Transicao } from "@/lib/agenda/laco";

/**
 * Espelha a transição de um agendamento (`calendar_appointments.status`) no
 * funil do CRM — MESMO padrão opt-in de `handoff-stage-move.ts`: a ponte é o
 * `slug` da etapa, e pipeline sem a etapa correspondente não muda de
 * comportamento nenhum (`sem_etapa_mapeada`, igual a `sem_etapa_de_handoff`).
 *
 * ⚠️ SÓ `pending` E `confirmed` AVANÇAM O CARD, de propósito. As demais
 * transições (`rescheduled`, `cancelled`, `completed`, `no_show`) não têm
 * entrada no mapa: cancelar ou faltar a UM compromisso não é o negócio
 * esfriando — o cliente pode remarcar, e quem decide que o negócio morreu
 * continua sendo o agente (`crm_stages.agent_stage_hint = 'lost'`) ou um
 * humano arrastando o card, nunca o agendamento sozinho.
 */
export const SLUG_ETAPA_POR_TRANSICAO: Partial<Record<Transicao, string>> = {
  pending: "agendamento-solicitado",
  confirmed: "agendado",
};

export interface ResultadoDoMovimentoDeAgendamento {
  moveu: boolean;
  motivo:
    | "decisao_humana_obrigatoria"
    | "movido"
    | "transicao_nao_mapeada"
    | "sem_etapa_mapeada"
    | "ja_esta_la"
    | "lead_nao_encontrado"
    | "lead_fechado"
    | "conflito_humano"
    | "falha_de_escrita"
    | "indisponivel";
}

export async function moverLeadParaEtapaDeAgendamento(
  _admin: SupabaseClient,
  _input: {
    organizationId: string;
    leadId: string;
    transicao: Transicao;
  },
): Promise<ResultadoDoMovimentoDeAgendamento> {
  return { moveu: false, motivo: "decisao_humana_obrigatoria" };
}
