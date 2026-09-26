import { z } from "zod";

import { AUTOMATION_CATALOG } from "@/lib/automation/catalogo";
import {
  aplicarModeloAtendimento,
  atualizarRegraAutomatica,
  criarRegraAutomatica,
  definirRegraAtiva,
  execucoesDasRegras,
  listarRegrasAutomaticas,
} from "@/lib/operacao/regras-automaticas";
import { actionSchema, conditionSchema, TRIGGER_EVENTS } from "@/lib/schemas/webhooks";
import type { McpContext, McpToolDefinition } from "../types";

const TRAVAS =
  "Envios passam pelas guardas do motor: janela de horário no fuso da organização, limite e ritmo do número, contato existente, não bloqueado, com telefone e consentimento. O sistema pode adiar ou impedir o envio; nunca prometa entrega imediata.";

function deps(ctx: McpContext) {
  return {
    supabase: ctx.supabase,
    organizationId: ctx.organizationId,
    actor: ctx.actor,
    requestId: ctx.requestId,
  };
}

const listRulesShape = { only_active: z.boolean().default(false) };
export const crmListAutomationRules: McpToolDefinition<typeof listRulesShape> = {
  name: "crm_list_automation_rules",
  description:
    "Lista as regras desta organização com gatilho, quantidade de condições, tipos de ação e estado ligado/pausado. A configuração das ações, como texto, URL e segredo, não é devolvida. " +
    `Use para identificar a regra antes de editar. Confira textos, número e responsável na tela antes de ligar. ${TRAVAS}`,
  inputSchema: listRulesShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (input, ctx) => ({
    regras: await listarRegrasAutomaticas(deps(ctx), { apenasAtivas: input.only_active }),
  }),
};

const describeShape = {};
export const crmDescribeAutomationOptions: McpToolDefinition<typeof describeShape> = {
  name: "crm_describe_automation_options",
  description:
    "Explica os gatilhos, ações, condições e travas que o motor realmente suporta. Use ANTES de montar uma regra para não inventar evento, ação ou campo. " +
    TRAVAS,
  inputSchema: describeShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async () => AUTOMATION_CATALOG,
};

const createRuleShape = {
  name: z.string().min(1).max(120),
  trigger_event: z.enum(TRIGGER_EVENTS),
  conditions: z.array(conditionSchema).max(10).default([]),
  actions: z.array(actionSchema).min(1).max(10),
};
export const crmCreateAutomationRule: McpToolDefinition<typeof createRuleShape> = {
  name: "crm_create_automation_rule",
  description:
    "Cria uma regra EDITÁVEL e sempre PAUSADA nesta organização. Use para preparar um fluxo que uma pessoa ainda vai revisar. " +
    `Criar não envia nada e não liga a regra. ${TRAVAS}`,
  inputSchema: createRuleShape,
  category: "write",
  requiresRole: "ai_operator",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => ({ regra: await criarRegraAutomatica(deps(ctx), input) }),
};

const updateRuleShape = {
  rule_id: z.string().uuid(),
  name: z.string().min(1).max(120).optional(),
  trigger_event: z.enum(TRIGGER_EVENTS).optional(),
  conditions: z.array(conditionSchema).max(10).optional(),
  actions: z.array(actionSchema).min(1).max(10).optional(),
};
export const crmUpdateAutomationRule: McpToolDefinition<typeof updateRuleShape> = {
  name: "crm_update_automation_rule",
  description:
    "Atualiza nome, gatilho, condições ou ações de uma regra desta organização e deixa a regra PAUSADA para revisão humana. " +
    `Liste e confira a regra antes. A configuração nova não age até uma pessoa ligar a regra novamente. ${TRAVAS}`,
  inputSchema: updateRuleShape,
  category: "write",
  requiresRole: "ai_operator",
  requiresScope: "mcp:write",
  handler: async ({ rule_id, ...input }, ctx) => ({
    regra: await atualizarRegraAutomatica(deps(ctx), rule_id, input),
  }),
};

const applyModelShape = {};
export const crmApplyAutomationModel: McpToolDefinition<typeof applyModelShape> = {
  name: "crm_apply_automation_model",
  description:
    "Aplica o fluxo modelo comercial uma única vez: primeira abordagem, avanço por resposta, entrega a uma pessoa e follow-up ao entrar na etapa. " +
    `Todas as regras e mensagens são EXEMPLOS EDITÁVEIS e nascem PAUSADAS. Reaplicar não duplica nem sobrescreve o que já foi editado. ${TRAVAS}`,
  inputSchema: applyModelShape,
  category: "write",
  requiresRole: "ai_operator",
  requiresScope: "mcp:write",
  handler: async (_input, ctx) => aplicarModeloAtendimento(deps(ctx)),
};

const setRuleActiveShape = { rule_id: z.string().uuid(), is_active: z.boolean() };
export const crmSetAutomationRuleActive: McpToolDefinition<typeof setRuleActiveShape> = {
  name: "crm_set_automation_rule_active",
  description:
    "Liga ou desliga uma regra. Ligar faz a regra agir sozinha em todo evento que casar. Antes de ligar, uma pessoa deve conferir na tela o gatilho, as condições, o número, o responsável e os textos. " +
    TRAVAS,
  inputSchema: setRuleActiveShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => ({
    regra: await definirRegraAtiva(deps(ctx), { id: input.rule_id, ativa: input.is_active }),
  }),
};

const listRunsShape = {
  rule_id: z.string().uuid().optional(),
  only_failures: z.boolean().default(false),
  limit: z.number().int().min(1).max(100).default(20),
};
export const crmListAutomationRuns: McpToolDefinition<typeof listRunsShape> = {
  name: "crm_list_automation_runs",
  description:
    "Mostra as execuções recentes das regras e os detalhes das ações que falharam ou foram impedidas. Use para conferir se uma mensagem saiu, foi adiada pela janela/limite ou foi barrada por contato, bloqueio, telefone ou consentimento.",
  inputSchema: listRunsShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (input, ctx) => ({
    execucoes: await execucoesDasRegras(deps(ctx), {
      ruleId: input.rule_id,
      limite: input.limit,
      apenasFalhas: input.only_failures,
    }),
  }),
};
