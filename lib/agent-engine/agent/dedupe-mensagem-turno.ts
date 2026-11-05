import type { Logger } from "../obs/logger";

const EMOJI_FINAL =
  /(?:\s*(?:\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*|\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3))+\s*$/gu;

export function normalizarMensagemDoTurno(body: string): string {
  return body
    .trim()
    .replace(/\s+/g, " ")
    .replace(EMOJI_FINAL, "")
    .trim()
    .toLocaleLowerCase("pt-BR");
}

export function mensagemJaEnviadaNesteTurno(
  body: string,
  enviadas: ReadonlySet<string>,
): boolean {
  return enviadas.has(normalizarMensagemDoTurno(body));
}

export function pularMensagemDuplicada(args: {
  body: string;
  enviadas: ReadonlySet<string>;
  log: Pick<Logger, "warn">;
}): { ok: true; status: "duplicate_skipped" } | null {
  const normalizada = normalizarMensagemDoTurno(args.body);
  if (!args.enviadas.has(normalizada)) return null;
  args.log.warn("mensagem duplicada no mesmo turno não enviada", {
    corpo_normalizado_tamanho: normalizada.length,
  });
  return { ok: true, status: "duplicate_skipped" };
}

export function registrarMensagemEnviadaNoTurno(body: string, enviadas: Set<string>): void {
  enviadas.add(normalizarMensagemDoTurno(body));
}
