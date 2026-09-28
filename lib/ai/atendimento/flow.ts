import type { AgentVersionRow } from "@/hooks/ai/useAgentVersions";

export type AtendimentoNodeId =
  | "entrada"
  | "agente"
  | "conhecimento"
  | "skills"
  | "handoff"
  | "followup"
  | "limites";

export type TravaId =
  | "opt_out"
  | "humano_em_atendimento"
  | "horario"
  | "ritmo_humano"
  | "uma_conversa"
  | "teto_diario"
  | "sem_inventar";

export interface TravaDoAtendimento {
  id: TravaId;
  label: string;
  consequence: string;
  enabled: boolean;
  toggleable: boolean;
}

export const TRAVAS_PADRAO: readonly TravaDoAtendimento[] = [
  {
    id: "opt_out",
    label: "Respeitar quem pediu para parar",
    consequence: "Sem esta proteção, o número pode voltar a abordar quem já recusou mensagens.",
    enabled: true,
    // O motor trata opt-out como regra irrevogável. A tela mostra a trava, mas
    // não oferece um interruptor decorativo que o runtime ignoraria.
    toggleable: false,
  },
  {
    id: "humano_em_atendimento",
    label: "Não responder por cima de uma pessoa",
    consequence: "Sem esta proteção, a automação pode disputar a conversa com o atendente humano.",
    enabled: true,
    toggleable: false,
  },
  {
    id: "horario",
    label: "Atender dentro do horário configurado",
    consequence: "Ao desligar, mensagens podem sair fora do horário de atendimento.",
    enabled: true,
    toggleable: true,
  },
  {
    id: "ritmo_humano",
    label: "Usar ritmo humano",
    consequence: "Ao desligar, as respostas podem sair no intervalo mínimo permitido pelo canal.",
    enabled: true,
    toggleable: true,
  },
  {
    id: "uma_conversa",
    label: "Atender uma conversa por vez",
    consequence: "Ao desligar, o mesmo número poderá conduzir várias conversas ao mesmo tempo.",
    enabled: true,
    toggleable: true,
  },
  {
    id: "teto_diario",
    label: "Limitar mensagens por dia",
    consequence: "Ao desligar, o número perde o teto diário adicional de segurança.",
    enabled: true,
    toggleable: true,
  },
  {
    id: "sem_inventar",
    label: "Não prometer nem inventar dados",
    consequence: "Sem esta proteção, o agente pode afirmar algo que nenhuma ferramenta confirmou.",
    enabled: true,
    toggleable: false,
  },
] as const;

export interface AtendimentoDraftState {
  templateId: "servicos" | "imobiliaria" | "clinica";
  name: string;
  objective: string;
  systemPrompt: string;
  handoffEnabled: boolean;
  handoffKeywords: string;
  followupEnabled: boolean;
  followupFlowIds: string[];
  businessHoursEnabled: boolean;
  startHour: number;
  endHour: number;
  humanPacingEnabled: boolean;
  oneConversationAtATime: boolean;
  dailyCapEnabled: boolean;
  dailyMessageLimit: number;
  disabledGuardrails: TravaId[];
}

export const TEMPLATE_SUMMARIES = [
  { id: "servicos", label: "Serviços e agência", description: "Orçamento, qualificação e passagem para a equipe." },
  { id: "imobiliaria", label: "Imobiliária", description: "Interesse, perfil do imóvel e visita com corretor." },
  { id: "clinica", label: "Clínica e agenda", description: "Dúvida inicial, triagem segura e agendamento." },
] as const;

const TEMPLATE_PROMPTS: Record<AtendimentoDraftState["templateId"], string> = {
  servicos:
    "Você atende quem pede orçamento de serviço. Entenda o pedido, o prazo e o local. Nunca prometa preço, desconto ou prazo sem confirmação da equipe. Não invente informações que nenhuma ferramenta devolveu.",
  imobiliaria:
    "Você atende quem procura imóvel. Entenda finalidade, região, tipo, faixa de valor e forma de pagamento. Nunca garanta crédito, reserva ou característica não confirmada. Não invente informações que nenhuma ferramenta devolveu.",
  clinica:
    "Você atende quem procura a clínica. Entenda o atendimento desejado e ajude a marcar horário. Nunca dê diagnóstico, indique tratamento ou invente informação clínica. Encaminhe urgências conforme o protocolo da organização.",
};

export function novoAtendimentoDoModelo(
  templateId: AtendimentoDraftState["templateId"],
): AtendimentoDraftState {
  const template = TEMPLATE_SUMMARIES.find((item) => item.id === templateId)!;
  return {
    templateId,
    name: "Atendimento",
    objective: template.description,
    systemPrompt: TEMPLATE_PROMPTS[templateId],
    handoffEnabled: true,
    handoffKeywords: "falar com humano, atendente, pessoa real",
    followupEnabled: false,
    followupFlowIds: [],
    businessHoursEnabled: true,
    startHour: 8,
    endHour: 18,
    humanPacingEnabled: true,
    oneConversationAtATime: true,
    dailyCapEnabled: true,
    dailyMessageLimit: 80,
    disabledGuardrails: [],
  };
}

function numero(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function estadoDaVersao(
  version: AgentVersionRow,
  agent: { name: string; description: string | null },
  dailyMessageLimit: number | null,
): AtendimentoDraftState {
  const channel = (version.channel_config ?? {}) as Record<string, unknown>;
  const trigger = (version.trigger_config ?? {}) as {
    filters?: { business_hours?: { start?: string; end?: string } | null };
  };
  const businessHours = trigger.filters?.business_hours;
  const maxConcurrent = numero(channel.max_concurrent_ai_conversations, 1);
  const throttle = numero(channel.throttle_ms, 1_200);
  const split = version.split_messages;
  const disabled: TravaId[] = [];
  if (!businessHours && channel.window_start_hour === undefined) disabled.push("horario");
  if (!split && throttle <= 1_200) disabled.push("ritmo_humano");
  if (maxConcurrent > 1) disabled.push("uma_conversa");
  if (dailyMessageLimit === null) disabled.push("teto_diario");
  return {
    templateId: "servicos",
    name: agent.name,
    objective: agent.description ?? "",
    systemPrompt: version.system_prompt,
    handoffEnabled: version.handoff_tool_enabled,
    handoffKeywords: version.handoff_keywords.join(", "),
    followupEnabled: version.followup?.enabled ?? false,
    followupFlowIds: version.followup?.flow_pointer_ids ?? [],
    businessHoursEnabled: !disabled.includes("horario"),
    startHour: numero(channel.window_start_hour, businessHours ? Number(businessHours.start?.slice(0, 2)) : 8),
    endHour: numero(channel.window_end_hour, businessHours ? Number(businessHours.end?.slice(0, 2)) : 18),
    humanPacingEnabled: !disabled.includes("ritmo_humano"),
    oneConversationAtATime: !disabled.includes("uma_conversa"),
    dailyCapEnabled: !disabled.includes("teto_diario"),
    dailyMessageLimit: dailyMessageLimit ?? 80,
    disabledGuardrails: disabled,
  };
}

export function travasDoEstado(state: AtendimentoDraftState): TravaDoAtendimento[] {
  return TRAVAS_PADRAO.map((trava) => ({
    ...trava,
    enabled: !state.disabledGuardrails.includes(trava.id),
  }));
}
