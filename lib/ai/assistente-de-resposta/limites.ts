import {
  checkRateLimit,
  type RateLimitResult,
} from "@/lib/ai/dispatcher/rate-limit";

interface LimitesDoAssistente {
  hourly_limit: number;
  daily_limit: number;
}

interface LimiteExcedido {
  allowed: false;
  code: "reply_assistant_hourly_limit" | "reply_assistant_daily_limit";
  message: string;
  details: RateLimitResult;
}

type Contador = (
  bucket: string,
  limit: number,
  windowSeconds: number,
) => Promise<RateLimitResult>;

export async function verificarLimitesDoAssistente(
  organizationId: string,
  limits: LimitesDoAssistente,
  count: Contador = checkRateLimit,
): Promise<{ allowed: true } | LimiteExcedido> {
  const windows = [
    {
      bucket: `reply-assistant:hour:${organizationId}`,
      limit: limits.hourly_limit,
      seconds: 60 * 60,
      code: "reply_assistant_hourly_limit",
      message: "O limite de sugestões desta hora foi atingido. Tente novamente mais tarde.",
    },
    {
      bucket: `reply-assistant:day:${organizationId}`,
      limit: limits.daily_limit,
      seconds: 24 * 60 * 60,
      code: "reply_assistant_daily_limit",
      message: "O limite diário de sugestões foi atingido. Tente amanhã ou ajuste o limite.",
    },
  ] as const;

  for (const window of windows) {
    const result = await count(window.bucket, window.limit, window.seconds);
    if (!result.allowed) {
      return {
        allowed: false,
        code: window.code,
        message: window.message,
        details: result,
      };
    }
  }
  return { allowed: true };
}
