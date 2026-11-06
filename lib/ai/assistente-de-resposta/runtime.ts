import type pg from "pg";

import {
  lerConfiguracaoDoAssistente,
  type ConfiguracaoDoAssistente,
} from "./config";
import {
  loadPublishedAgentConfigById,
  type PublishedAgentConfig,
} from "@/lib/agent-engine/agent/agent-config";

export interface AssistenteDeRespostaAtivo {
  settings: ConfiguracaoDoAssistente;
  agent: PublishedAgentConfig;
}

export async function carregarAssistenteDeResposta(
  pool: pg.Pool,
  organizationId: string,
): Promise<AssistenteDeRespostaAtivo | null> {
  const { rows } = await pool.query<{ id: string; config: unknown }>(
    `select id,config from ai_agents
     where organization_id=$1
       and archived_at is null
       and operation_mode='assisted'
       and paused_at is not null
       and not is_active
       and config @> '{"reply_assistant":{"managed":true,"enabled":true}}'::jsonb
     order by created_at asc
     limit 1`,
    [organizationId],
  );
  const row = rows[0];
  const settings = lerConfiguracaoDoAssistente(row?.config);
  if (!row || !settings) return null;
  const agent = await loadPublishedAgentConfigById(pool, organizationId, row.id, {
    allowManagedReplyAssistant: true,
  });
  if (!agent || agent.operationMode !== "assisted" || !agent.pausedAt) return null;
  // O rascunho entrega este `agent` ao mesmo `runAgentPreview` usado pelos
  // demais agentes. Ali provider/model/credentialId viram `llmOverride` do seam
  // único (`runModelCall`) e chegam ao registry, inclusive para OpenRouter.
  // Não há cliente HTTP nem resolução de provedor paralela neste runtime.
  return { settings, agent };
}
