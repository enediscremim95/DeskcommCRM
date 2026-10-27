export interface GuardasDaAutomacao {
  maxMessageAgeMinutes?: number;
  sameChannelOnly: boolean;
}

function registro(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Lê o jsonb livre da organização sem transformar lixo em proteção global.
 * Qualquer campo ausente ou fora do contrato deixa somente aquela trava desligada.
 */
export function lerGuardasDaAutomacao(settings: unknown): GuardasDaAutomacao {
  const raiz = registro(settings);
  const raw = registro(raiz?.automation_guards);
  if (!raw) return { sameChannelOnly: false };

  const maxAge = raw.max_message_age_minutes;
  const maxMessageAgeMinutes =
    typeof maxAge === "number" && Number.isFinite(maxAge) && maxAge > 0
      ? maxAge
      : undefined;

  return {
    ...(maxMessageAgeMinutes === undefined ? {} : { maxMessageAgeMinutes }),
    sameChannelOnly: raw.same_channel_only === true,
  };
}
