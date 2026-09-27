import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const configSchema = z.object({
  automation_rule_id: z.string().uuid(),
  resuggest_after_days: z.number().int().min(2).max(365),
});

const conditionSchema = z.object({
  field: z.literal("event.to_stage_id"),
  op: z.literal("eq"),
  value: z.string().uuid(),
});

const actionSchema = z.object({
  type: z.literal("send_whatsapp_message"),
  config: z.object({
    channel_session_id: z.string().uuid(),
    template: z.string().min(1).max(2000),
  }),
});

export interface ConfiguracaoFollowupAprovavel {
  automationRuleId: string;
  automationRuleName: string;
  targetStageId: string;
  channelSessionId: string;
  message: string;
  resuggestAfterDays: number;
}

export interface RegraDeAutomacaoCandidata {
  id: string;
  name: string;
  trigger_event: string;
  is_active: boolean;
  conditions: unknown;
  actions: unknown;
}

/**
 * Uma regra aprovada para esta costura tem UMA condição e UMA ação.
 *
 * Isso é intencional: aprovar uma sugestão não pode, por acidente, executar
 * tags, webhooks ou outra ação que o botão não anuncia. A regra continua sendo
 * configurada na tela de Automações, mas o encaixe só aceita a forma explícita
 * "entrou na etapa X -> envia esta mensagem fixa por este número".
 */
export function lerRegraDeFollowupAprovavel(
  rule: RegraDeAutomacaoCandidata,
): Omit<ConfiguracaoFollowupAprovavel, "resuggestAfterDays"> | null {
  if (!rule.is_active || rule.trigger_event !== "lead.stage_changed") return null;
  if (!Array.isArray(rule.conditions) || rule.conditions.length !== 1) return null;
  if (!Array.isArray(rule.actions) || rule.actions.length !== 1) return null;

  const condition = conditionSchema.safeParse(rule.conditions[0]);
  const action = actionSchema.safeParse(rule.actions[0]);
  if (!condition.success || !action.success) return null;

  return {
    automationRuleId: rule.id,
    automationRuleName: rule.name,
    targetStageId: condition.data.value,
    channelSessionId: action.data.config.channel_session_id,
    message: action.data.config.template,
  };
}

export function lerConfigDoPipeline(settings: unknown): z.infer<typeof configSchema> | null {
  if (!settings || typeof settings !== "object") return null;
  const raw = (settings as { followup_approval?: unknown }).followup_approval;
  const parsed = configSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export async function resolveConfiguracaoFollowupAprovavel(
  db: SupabaseClient,
  organizationId: string,
  pipelineId: string,
): Promise<ConfiguracaoFollowupAprovavel | null> {
  const { data: pipeline, error: pipelineError } = await db
    .from("crm_pipelines")
    .select("settings")
    .eq("id", pipelineId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (pipelineError) throw new Error(`configuração do follow-up: ${pipelineError.message}`);

  const config = lerConfigDoPipeline(pipeline?.settings);
  if (!config) return null;

  const { data: rule, error: ruleError } = await db
    .from("automation_rules")
    .select("id, name, trigger_event, is_active, conditions, actions")
    .eq("id", config.automation_rule_id)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (ruleError) throw new Error(`regra do follow-up: ${ruleError.message}`);
  if (!rule) return null;

  const parsed = lerRegraDeFollowupAprovavel(rule as RegraDeAutomacaoCandidata);
  if (!parsed) return null;

  // A etapa configurada precisa pertencer ao MESMO funil. Sem esta prova, uma
  // regra antiga pode apontar para outro funil e o botão só falharia no clique.
  const { data: stage, error: stageError } = await db
    .from("crm_stages")
    .select("id")
    .eq("id", parsed.targetStageId)
    .eq("pipeline_id", pipelineId)
    .eq("organization_id", organizationId)
    .eq("is_archived", false)
    .maybeSingle();
  if (stageError) throw new Error(`etapa do follow-up: ${stageError.message}`);
  if (!stage) return null;

  return { ...parsed, resuggestAfterDays: config.resuggest_after_days };
}

export interface FatosDaSugestao {
  stageId: string;
  lastInboundAt: string | null;
}

export interface UltimaSugestaoDecidida extends FatosDaSugestao {
  resuggestAfterAt: string | null;
}

/**
 * Depois de uma decisão, só há uma nova sugestão com fato novo ou prazo longo.
 * Igualdade inclui `null`: ausência de atividade continua sendo o mesmo fato.
 */
export function deveSugerirNovamente(
  anterior: UltimaSugestaoDecidida | null,
  atual: FatosDaSugestao,
  now: Date,
): boolean {
  if (!anterior) return true;
  if (anterior.stageId !== atual.stageId) return true;
  if (anterior.lastInboundAt !== atual.lastInboundAt) return true;
  if (!anterior.resuggestAfterAt) return false;
  return now.getTime() >= new Date(anterior.resuggestAfterAt).getTime();
}

/** A resposta é a última entrada do contato, não qualquer atividade do negócio. */
export async function leUltimaRespostaDoContato(
  db: SupabaseClient,
  organizationId: string,
  contactId: string,
): Promise<string | null> {
  const { data, error } = await db
    .from("conversations")
    .select("last_inbound_at")
    .eq("organization_id", organizationId)
    .eq("contact_id", contactId)
    .not("last_inbound_at", "is", null)
    .order("last_inbound_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`última resposta do contato: ${error.message}`);
  return (data as { last_inbound_at: string | null } | null)?.last_inbound_at ?? null;
}

export function estadoDaAprovacao(proximaAbertura: string | null):
  | { delivery_status: "queued_window"; scheduled_for: string }
  | { delivery_status: "processing"; scheduled_for: null } {
  return proximaAbertura
    ? { delivery_status: "queued_window", scheduled_for: proximaAbertura }
    : { delivery_status: "processing", scheduled_for: null };
}
