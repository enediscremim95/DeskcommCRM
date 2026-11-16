// Política 16/11/2026: IA/automação observa o funil; somente humanos movem cards.
import type { ServiceBoundary } from "@/lib/atendimento/fronteira";
import type { SupabaseClient } from "@supabase/supabase-js";


/**
 * Move o card do lead para a etapa do funil que o tenant marcou como destino
 * de handoff, sempre que o orquestrador (`lib/ai/handoff/orchestrator.ts`)
 * decide que um atendimento precisa de humano.
 *
 * ⚠️ OPT-IN POR PIPELINE, via `slug`, não `requires_human`. `requires_human`
 * já é usado por `checkG4Stage` no sentido INVERSO (lead JÁ está numa etapa
 * assim → dispara handoff) e mais de uma etapa pode carregar essa flag no
 * mesmo pipeline (ex.: "Repassado para o Fernando", que é atribuição a uma
 * PESSOA, não "precisa de humano agora"). `slug` é estável, único por
 * pipeline (`uniq_crm_stages_pipeline_slug`) e é exatamente o campo que este
 * schema já tem para apontar sem ambiguidade — different de `name`, que o
 * tenant pode renomear a qualquer momento.
 *
 * Pipeline SEM essa etapa (todo clone novo, por padrão) não muda de
 * comportamento nenhum: `sem_etapa_de_handoff` é resposta legítima, igual ao
 * `sem_mapeamento` de `agent-stage-sync.ts` — não inventamos etapa que o
 * tenant não criou.
 */
export const SLUG_ETAPA_HANDOFF = "chamar-humano";

export interface ResultadoDoMovimentoDeHandoff {
  moveu: boolean;
  motivo:
    | "decisao_humana_obrigatoria"
    | "movido"
    | "sem_etapa_de_handoff"
    | "ja_esta_la"
    | "lead_nao_encontrado"
    | "lead_fechado"
    | "conflito_humano"
    | "falha_de_escrita"
    | "indisponivel";
}

export async function moverLeadParaEtapaDeHandoff(
  _admin: SupabaseClient,
  _input: {
    organizationId: string;
    leadId: string;
    /** `HandoffReason` de `lib/ai/handoff/orchestrator.ts` — string aqui para não acoplar os dois módulos. */
    reason: string;
    serviceBoundary?: ServiceBoundary;
  },
): Promise<ResultadoDoMovimentoDeHandoff> {
  return { moveu: false, motivo: "decisao_humana_obrigatoria" };
}
