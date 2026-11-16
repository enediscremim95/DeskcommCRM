// Política 16/11/2026: IA/automação observa o funil; somente humanos movem cards.
import type { RiskBucket } from "@/lib/leads/risk-radar";

/**
 * O funil do AGENTE movendo o card no funil do TENANT (wave 8, cenários 25/26).
 *
 * O agente pensa em sete passos fixos (`lead_state.stage`); o tenant nomeia os
 * dele — "Avaliação" numa clínica, "Aguardando pagamento" num e-commerce. A
 * ponte é `crm_stages.agent_stage_hint` (migration 0084).
 *
 * ⚠️ ESTE ARQUIVO NÃO ADIVINHA NADA. As três respostas possíveis são mover,
 * não mover, ou não ter para onde — e a terceira é um estado legítimo do
 * produto, não um erro a contornar.
 */

/** O que o resolvedor sabe de cada estágio do pipeline. */
export interface EstagioCandidato {
  id: string;
  name: string;
  agent_stage_hint: string | null;
  is_archived: boolean;
}

export type DestinoDoAgente =
  | { move: true; stageId: string; stageName: string }
  /**
   * `sem_mapeamento` — o pipeline não declarou nenhum estágio para este passo.
   *
   * NÃO é erro e NÃO tem fallback: mover para "o mais próximo por posição"
   * inventaria semântica que o tenant não declarou, e o negócio apareceria num
   * lugar que ninguém escolheu. O card fica onde está, e o rastro registra que
   * o agente quis mover.
   */
  | { move: false; motivo: "sem_mapeamento"; passo: string }
  /** O agente está no passo que o negócio já ocupa: nada a fazer, e não é falha. */
  | { move: false; motivo: "ja_esta_la"; passo: string };

/**
 * Para onde o negócio vai quando o agente avança para `passo`.
 *
 * ⚠️ NÃO TRATA AMBIGUIDADE, e isso é deliberado: `uniq_crm_stages_pipeline_hint`
 * (0084) torna dois estágios com o mesmo hint IMPOSSÍVEIS no banco. Tratar aqui
 * seria proteger contra um estado que não pode existir — e, pior, faria alguém
 * acreditar que pode. A recusa mora na CONFIGURAÇÃO, onde chega a quem
 * configurou e ensina; recusa no uso chegaria a um terceiro, meses depois, sem
 * contexto nenhum.
 *
 * Estágio ARQUIVADO não é destino: ele é histórico, e mandar um negócio vivo
 * para lá o esconderia do board.
 */
export function resolveDestinoDoAgente(
  estagios: EstagioCandidato[],
  passo: string,
  estagioAtualId: string,
): DestinoDoAgente {
  const alvo = estagios.find((e) => !e.is_archived && e.agent_stage_hint === passo);
  if (!alvo) return { move: false, motivo: "sem_mapeamento", passo };
  if (alvo.id === estagioAtualId) return { move: false, motivo: "ja_esta_la", passo };
  return { move: true, stageId: alvo.id, stageName: alvo.name };
}

/**
 * O texto que vai para a timeline quando o agente move o negócio.
 *
 * Nomeia os DOIS lados da tradução — o passo do agente e o estágio do tenant —
 * porque quem lê a timeline conhece só o segundo, e quem depura conhece só o
 * primeiro. "Movido para Avaliação" esconde que foi o agente; "avançou para
 * qualifying" é vocabulário que o usuário nunca viu.
 */
export function razaoDaMudancaPeloAgente(stageName: string, passo: string): string {
  return `Movido para ${stageName} pelo assistente (passo "${passo}" do atendimento)`;
}

export type { RiskBucket };

/* ────────────────────────────────────────────────────────────────────────── */

import type { SupabaseClient } from "@supabase/supabase-js";


export interface ResultadoDaSincronizacao {
  moveu: boolean;
  /**
   * ⚠️ NENHUM RÓTULO PODE MENTIR — é o que separa os três grupos:
   *  - estado legítimo do produto: `sem_mapeamento`, `sem_negocio`, `ambiguo`,
   *    `ja_esta_la`, `conflito_humano` (o card não andou, e ninguém errou);
   *  - o banco não respondeu: `indisponivel` (o funil PAROU — alguém precisa saber);
   *  - a escrita falhou: `falha_de_escrita`.
   * Reaproveitar um rótulo do primeiro grupo para os outros dois transformaria
   * indisponibilidade em rotina, que é o defeito que esta função já teve.
   */
  motivo:
    | "decisao_humana_obrigatoria"
    | "movido"
    | "sem_mapeamento"
    | "ja_esta_la"
    | "sem_negocio"
    | "ambiguo"
    | "conflito_humano"
    /**
     * O negócio está num funil que este agente não cuida (spec 17 passo 3).
     *
     * ⚠️ NÃO é o mesmo que `sem_mapeamento`: lá falta configuração de ETAPA (o
     * agente cuidaria, mas não sabe para onde ir); aqui a configuração está
     * COMPLETA e a resposta é não. E não é `falha_de_escrita`: nada falhou — a
     * regra funcionou.
     */
    | "fora_do_escopo"
    | "falha_de_escrita"
    | "indisponivel";
  leadId?: string;
  stageName?: string;
  detalhe?: string;
}

/**
 * O agente avançou o próprio funil — o card acompanha, se houver para onde.
 *
 * ⚠️ REUSA `resolveActiveLeadForContact`, e isso não é economia de código: o
 * funil do agente é por CONTATO e o card é por NEGÓCIO, então um contato com
 * dois negócios abertos exige decidir qual se move. A wave 4 já decidiu isso
 * para a próxima ação, e um SEGUNDO resolvedor de "qual negócio deste contato"
 * seria a doença desta entrega inteira criada de propósito — duas fontes que
 * começam iguais e divergem no primeiro ajuste.
 *
 * Ambíguo NÃO move nenhum, pela mesma razão da wave 4: mover o negócio errado é
 * pior que não mover, porque o usuário vê um card se mexendo sozinho e não tem
 * como saber por quê.
 */
export async function sincronizaEstagioDoAgente(
  _admin: SupabaseClient,
  _input: {
    organizationId: string;
    contactId: string;
    passo: string;
    /**
     * Funis que ESTE agente pode escrever (`ai_agent_versions.pipeline_ids`).
     *
     * `undefined` = chamador que ainda não sabe do escopo (caminho legado):
     * segue como antes. Array VAZIO = nenhum funil, e aí nada é movido — a
     * distinção existe porque tratar "não informado" como "vazio" pararia todo
     * caminho que ainda não foi migrado, em silêncio.
     */
    escopoDeFunis?: readonly string[];
  },
): Promise<ResultadoDaSincronizacao> {
  return { moveu: false, motivo: "decisao_humana_obrigatoria" };
}
