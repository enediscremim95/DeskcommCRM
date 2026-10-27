/** Marca que o evento já cruzou a trava no início da regra. */
export const IDADE_DA_MENSAGEM_AVALIADA_METADATA_KEY =
  "automation_message_age_evaluated";

export interface MensagemDoContextoDaAutomacao {
  sent_at?: string | null;
}

export type DecisaoDeIdadeDaMensagem =
  | {
      status: "recente" | "antiga";
      messageSentAt: string;
      ageMs: number;
      maxAgeMinutes: number;
    }
  | { status: "desconhecida"; maxAgeMinutes: number }
  | { status: "desligada" };

export function avaliarIdadeDaMensagem(
  message: MensagemDoContextoDaAutomacao | undefined,
  maxAgeMinutes: number | undefined,
  nowMs: number = Date.now(),
): DecisaoDeIdadeDaMensagem {
  if (
    typeof maxAgeMinutes !== "number" ||
    !Number.isFinite(maxAgeMinutes) ||
    maxAgeMinutes <= 0
  ) {
    return { status: "desligada" };
  }
  const messageSentAt = message?.sent_at;
  if (typeof messageSentAt !== "string" || !messageSentAt.trim()) {
    return { status: "desconhecida", maxAgeMinutes };
  }

  const sentAtMs = Date.parse(messageSentAt);
  if (!Number.isFinite(sentAtMs)) return { status: "desconhecida", maxAgeMinutes };

  const ageMs = Math.max(0, nowMs - sentAtMs);
  return {
    status: ageMs > maxAgeMinutes * 60_000 ? "antiga" : "recente",
    messageSentAt,
    ageMs,
    maxAgeMinutes,
  };
}
