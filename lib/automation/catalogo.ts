import type { CreateAutomationRuleInput } from "@/lib/schemas/webhooks";

export const MODELO_ATENDIMENTO_PREFIXO = "Modelo para revisar:";

/**
 * Vocabulário público do motor de automação.
 *
 * A tela, o MCP e os testes devem apontar para esta lista. Assim a IA não
 * inventa gatilhos ou ações que o engine não sabe executar.
 */
export const AUTOMATION_CATALOG = {
  triggers: [
    { id: "lead.created", faz: "Dispara quando um lead novo entra no CRM." },
    { id: "lead.stage_changed", faz: "Dispara quando um lead muda de etapa no funil." },
    { id: "message.received", faz: "Dispara quando chega uma mensagem do contato." },
    { id: "lead.tag_added", faz: "Dispara quando uma tag é adicionada ao lead." },
    { id: "contact.tag_added", faz: "Dispara quando uma tag é adicionada ao contato." },
  ],
  actions: [
    { id: "send_whatsapp_message", faz: "Envia uma mensagem editável pelo número escolhido." },
    { id: "send_ai_message", faz: "Pede a um agente publicado para escrever e enviar a mensagem." },
    { id: "create_or_move_lead", faz: "Cria o lead ou move o lead existente para uma etapa do mesmo funil." },
    { id: "add_tag", faz: "Adiciona uma ou mais tags ao lead ou contato." },
    { id: "assign_owner", faz: "Atribui o lead e a conversa a uma pessoa ativa da equipe, interrompendo o atendimento automático quando há conversa." },
    { id: "call_webhook", faz: "Avisa outro sistema por uma URL HTTPS validada." },
    { id: "start_message_flow", faz: "Inicia um fluxo de follow-up publicado." },
  ],
  conditions: {
    operators: ["eq", "neq", "contains"],
    fields: [
      "lead.title",
      "lead.tags",
      "lead.source_metadata.utm_source",
      "event.to_stage_id",
      "event.body_preview",
      "event.added_tags",
      "contact.tags",
    ],
    faz: "Todas as condições precisam ser verdadeiras para a regra executar.",
  },
  guards: {
    channel_window:
      "Mensagens esperam a janela de horário configurada para o número em Conexões, no fuso da organização.",
    daily_limit:
      "Mensagens respeitam o limite diário e o ritmo com espaçamento e variação configurados para o número.",
    contact:
      "O envio só é tentado se o contato existir, não estiver bloqueado, tiver telefone e tiver consentimento.",
    review:
      "Regras novas e regras do fluxo modelo nascem pausadas. Uma pessoa precisa revisar e ligar pela tela ou pela ferramenta própria.",
  },
} as const;

export type AutomationRuleDraft = CreateAutomationRuleInput & { id: string };
