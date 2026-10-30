import { z } from "zod";

export const PROVEDORES_DO_ASSISTENTE = ["anthropic", "openai"] as const;
export type ProvedorDoAssistente = (typeof PROVEDORES_DO_ASSISTENTE)[number];

export const INSTRUCAO_PADRAO_DO_ASSISTENTE =
  "Sugira a próxima resposta em português do Brasil, curta e natural, no tom da equipe. " +
  "Use somente informações confirmadas na conversa. Não invente preço, prazo, frete, estoque ou condição comercial.";

export const configuracaoDoAssistenteSchema = z
  .object({
    managed: z.literal(true),
    enabled: z.boolean(),
    provider: z.enum(PROVEDORES_DO_ASSISTENTE),
    model: z.string().trim().min(1).max(120),
    credential_id: z.string().uuid(),
    team_style: z.string().trim().min(10).max(4_000),
    history_message_window: z.number().int().min(5).max(80),
    history_token_window: z.number().int().min(1_000).max(16_000),
    hourly_limit: z.number().int().min(1).max(200),
    daily_limit: z.number().int().min(1).max(2_000),
    // Configurações gravadas antes da sugestão automática continuam válidas e
    // recebem o comportamento pedido para quem liga o assistente: ligado.
    auto_suggest: z.boolean().default(true),
  })
  .strict();

export type ConfiguracaoDoAssistente = z.infer<typeof configuracaoDoAssistenteSchema>;

export const pedidoDoAssistenteSchema = z
  .object({
    enabled: z.boolean(),
    provider: z.enum(PROVEDORES_DO_ASSISTENTE).optional(),
    credential_id: z.string().uuid().optional(),
    team_style: z.string().trim().min(10).max(4_000).optional(),
    history_message_window: z.number().int().min(5).max(80).optional(),
    history_token_window: z.number().int().min(1_000).max(16_000).optional(),
    hourly_limit: z.number().int().min(1).max(200).optional(),
    daily_limit: z.number().int().min(1).max(2_000).optional(),
    auto_suggest: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.enabled) return;
    for (const field of [
      "provider",
      "credential_id",
      "team_style",
      "history_message_window",
      "history_token_window",
      "hourly_limit",
      "daily_limit",
    ] as const) {
      if (value[field] === undefined) {
        ctx.addIssue({ code: "custom", path: [field], message: "Obrigatório ao ligar." });
      }
    }
  });

export function lerConfiguracaoDoAssistente(config: unknown): ConfiguracaoDoAssistente | null {
  if (!config || typeof config !== "object" || Array.isArray(config)) return null;
  const candidate = (config as Record<string, unknown>).reply_assistant;
  const parsed = configuracaoDoAssistenteSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

export function ehAssistenteDeRespostaGerenciado(config: unknown): boolean {
  if (!config || typeof config !== "object" || Array.isArray(config)) return false;
  const candidate = (config as Record<string, unknown>).reply_assistant;
  return Boolean(
    candidate &&
    typeof candidate === "object" &&
    !Array.isArray(candidate) &&
    (candidate as Record<string, unknown>).managed === true,
  );
}

export function montarPromptDoAssistente(teamStyle: string): string {
  return [
    "Você é um assistente de resposta para uma equipe humana.",
    "Sua única tarefa é sugerir um rascunho. Nunca envie mensagens, nunca execute ações e nunca afirme que executou algo.",
    INSTRUCAO_PADRAO_DO_ASSISTENTE,
    `Como a equipe fala:\n${teamStyle.trim()}`,
    "Responda somente com o texto que a pessoa atendente pode revisar e editar.",
  ].join("\n\n");
}

interface ModeloCandidato {
  model_id: string;
  is_default_for_provider?: boolean | null;
}

export function escolherModeloDoAssistente(
  catalogo: readonly ModeloCandidato[],
  modelosDaChave: readonly string[] | null,
): string | null {
  const disponiveis = modelosDaChave?.length ? new Set(modelosDaChave) : null;
  const compativeis = catalogo.filter((modelo) => !disponiveis || disponiveis.has(modelo.model_id));
  return (
    compativeis.find((modelo) => modelo.is_default_for_provider)?.model_id ??
    compativeis[0]?.model_id ??
    null
  );
}

/**
 * Nome usado dentro do prompt, deliberadamente conservador.
 *
 * `contacts.name` também recebe títulos de pedido, campanha e telefone em
 * integrações antigas. Só aceitamos de uma a quatro palavras formadas por
 * letras. Na dúvida devolvemos null e o rascunho fala sem vocativo.
 */
export function nomeSeguroParaSugestao(value: string | null | undefined): string | null {
  const nome = value?.trim().replace(/\s+/g, " ") ?? "";
  if (!nome || nome.length > 80 || /\d|@|https?:|[\r\n]/i.test(nome)) return null;
  const palavras = nome.split(" ");
  if (palavras.length > 4) return null;
  if (/\b(box|pedido|produto|entrega|frete|orçamento|orcamento|kit|pacote)\b/iu.test(nome)) {
    return null;
  }
  const conectivos = new Set(["da", "das", "de", "do", "dos", "e"]);
  const palavraHumana = /^\p{Lu}[\p{L}'’-]{0,29}$/u;
  const siglaHumana = /^\p{Lu}{2,30}$/u;
  return palavras.every(
    (palavra, index) =>
      palavraHumana.test(palavra) ||
      siglaHumana.test(palavra) ||
      (index > 0 && conectivos.has(palavra.toLocaleLowerCase("pt-BR"))),
  )
    ? nome
    : null;
}

export function patchSeguroDoAgenteInterno(now: string) {
  return {
    operation_mode: "assisted" as const,
    paused_at: now,
    is_active: false,
    priority: -1_000_000,
  };
}
