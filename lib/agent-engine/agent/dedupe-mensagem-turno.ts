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

function paragrafosDaMensagem(body: string): string[] {
  const paragrafos = body
    .split(/\r?\n\s*\r?\n+/)
    .map((paragrafo) => paragrafo.trim())
    .filter((paragrafo) => paragrafo !== "");

  // Corpo vazio continua seguindo para os guardrails/canal como antes. O helper
  // só decide repetição, não passa a validar conteúdo por acidente.
  return paragrafos.length > 0 ? paragrafos : [body.trim()];
}

export function mensagemJaEnviadaNesteTurno(
  body: string,
  enviadas: ReadonlySet<string>,
): boolean {
  return paragrafosDaMensagem(body).every((paragrafo) =>
    enviadas.has(normalizarMensagemDoTurno(paragrafo)),
  );
}

export type ResultadoFiltroMensagemDoTurno =
  | {
      status: "duplicate_skipped";
      ok: true;
      paragrafos_recebidos: number;
      paragrafos_enviados: 0;
      paragrafos_repetidos_removidos: number;
    }
  | {
      status: "pronta";
      body: string;
      paragrafos_recebidos: number;
      paragrafos_enviados: number;
      paragrafos_repetidos_removidos: number;
    };

/**
 * Remove somente parágrafos já enviados no mesmo turno. Não faz comparação
 * fuzzy: um parágrafo parecido, mas novo, continua sendo enviado.
 */
export function filtrarMensagemDoTurno(args: {
  body: string;
  enviadas: ReadonlySet<string>;
  log: Pick<Logger, "warn">;
}): ResultadoFiltroMensagemDoTurno {
  const paragrafos = paragrafosDaMensagem(args.body);
  const vistos = new Set(args.enviadas);
  const novos = paragrafos.filter((paragrafo) => {
    const normalizado = normalizarMensagemDoTurno(paragrafo);
    if (vistos.has(normalizado)) return false;
    vistos.add(normalizado);
    return true;
  });
  const removidos = paragrafos.length - novos.length;

  if (removidos > 0) {
    args.log.warn("parágrafos repetidos no mesmo turno não enviados", {
      paragrafos_recebidos: paragrafos.length,
      paragrafos_enviados: novos.length,
      paragrafos_repetidos_removidos: removidos,
    });
  }

  if (novos.length === 0) {
    return {
      status: "duplicate_skipped",
      ok: true,
      paragrafos_recebidos: paragrafos.length,
      paragrafos_enviados: 0,
      paragrafos_repetidos_removidos: removidos,
    };
  }

  return {
    status: "pronta",
    body: novos.join("\n\n"),
    paragrafos_recebidos: paragrafos.length,
    paragrafos_enviados: novos.length,
    paragrafos_repetidos_removidos: removidos,
  };
}

export function resultadoDeEnvioSemRepeticao(
  filtro: ResultadoFiltroMensagemDoTurno,
): {
  ok: true;
  status: "enviado_sem_repeticao";
  paragrafos_repetidos_removidos: number;
} | null {
  if (filtro.status !== "pronta" || filtro.paragrafos_repetidos_removidos === 0) return null;
  return {
    ok: true,
    status: "enviado_sem_repeticao",
    paragrafos_repetidos_removidos: filtro.paragrafos_repetidos_removidos,
  };
}

export function registrarMensagemEnviadaNoTurno(body: string, enviadas: Set<string>): void {
  for (const paragrafo of paragrafosDaMensagem(body)) {
    enviadas.add(normalizarMensagemDoTurno(paragrafo));
  }
}
