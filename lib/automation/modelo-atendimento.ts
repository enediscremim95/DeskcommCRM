import { createHash } from "node:crypto";

import {
  MODELO_ATENDIMENTO_PREFIXO,
  type AutomationRuleDraft,
} from "@/lib/automation/catalogo";

export interface ModeloAtendimentoContexto {
  organizationId: string;
  channelSessionId: string;
  pipelineId: string;
  nextStageId: string;
  followupStageId: string;
  ownerUserId: string;
}

/** UUID v5 determinístico sem dependência externa. O id inclui a organização. */
export function idDaRegraModelo(organizationId: string, chave: string): string {
  const bytes = createHash("sha1")
    .update(`automacao:fluxo-atendimento-modelo:v1:${organizationId}:${chave}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Quatro regras pausadas que cobrem o primeiro contato, avanço, entrega humana
 * e follow-up. Os textos são deliberadamente exemplos, nunca copy pronta.
 */
export function regrasDoModeloAtendimento(ctx: ModeloAtendimentoContexto): AutomationRuleDraft[] {
  const id = (chave: string) => idDaRegraModelo(ctx.organizationId, chave);
  return [
    {
      id: id("primeira-abordagem"),
      name: `${MODELO_ATENDIMENTO_PREFIXO} primeira abordagem`,
      trigger_event: "lead.created",
      conditions: [],
      actions: [
        {
          type: "send_whatsapp_message",
          config: {
            channel_session_id: ctx.channelSessionId,
            template:
              "EXEMPLO, REVISE ANTES DE LIGAR: Olá {{nome}}, recebemos seu contato. Posso entender melhor o que você procura?",
          },
        },
      ],
    },
    {
      id: id("resposta-avanca"),
      name: `${MODELO_ATENDIMENTO_PREFIXO} resposta avança o lead`,
      trigger_event: "message.received",
      conditions: [{ field: "event.body_preview", op: "contains", value: "quero avançar" }],
      actions: [
        {
          type: "create_or_move_lead",
          config: { pipeline_id: ctx.pipelineId, stage_id: ctx.nextStageId },
        },
      ],
    },
    {
      id: id("resposta-entrega-humano"),
      name: `${MODELO_ATENDIMENTO_PREFIXO} pedido de pessoa entrega ao responsável`,
      trigger_event: "message.received",
      conditions: [{ field: "event.body_preview", op: "contains", value: "falar com uma pessoa" }],
      actions: [{ type: "assign_owner", config: { user_id: ctx.ownerUserId } }],
    },
    {
      id: id("followup-na-etapa"),
      name: `${MODELO_ATENDIMENTO_PREFIXO} follow-up ao entrar na etapa`,
      trigger_event: "lead.stage_changed",
      conditions: [{ field: "event.to_stage_id", op: "eq", value: ctx.followupStageId }],
      actions: [
        {
          type: "send_whatsapp_message",
          config: {
            channel_session_id: ctx.channelSessionId,
            template:
              "EXEMPLO, REVISE ANTES DE LIGAR: Oi {{nome}}, passando para saber se ainda posso ajudar você com este assunto.",
          },
        },
      ],
    },
  ];
}
