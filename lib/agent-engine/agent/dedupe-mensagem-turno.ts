import type { Logger } from "../obs/logger";

const EMOJI_FINAL =
  /(?:\s*(?:\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*|\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3))+\s*$/gu;

export const LIMIAR_SEMELHANCA_PARAGRAFO = 0.7;

const STOPWORDS_PT_BR = new Set([
  "a", "ao", "aos", "as", "com", "da", "das", "de", "do", "dos", "e", "ela", "elas",
  "ele", "eles", "em", "essa", "essas", "esse", "esses", "esta", "estas", "este", "estes",
  "eu", "mais", "na", "nas", "no", "nos", "o", "os", "ou", "para", "por", "pra", "que",
  "se", "sem", "sua", "suas", "seu", "seus", "te", "tem", "um", "uma", "voce", "voces",
]);

/**
 * Alternativas que mudam o referente, mesmo quando o restante da frase é quase
 * igual. Números e valores são tratados separadamente, sem lista fechada.
 */
const GRUPOS_DISTINTIVOS = [
  new Set(["kraft", "pinus"]),
  new Set(["azul", "branco", "branca", "preto", "preta", "rosa", "verde", "vermelho", "vermelha"]),
  new Set(["casal", "dupla", "individual", "unitario", "unitaria"]),
  new Set(["sim", "nao"]),
  new Set(["com", "sem"]),
  new Set(["disponivel", "disponiveis", "indisponivel", "indisponiveis", "esgotado", "esgotada"]),
  new Set(["antes", "depois"]),
  new Set(["maior", "menor"]),
];

const MARCADORES_UNILATERAIS_DE_SENTIDO = new Set([
  "esgotada",
  "esgotado",
  "indisponivel",
  "jamais",
  "nao",
  "nunca",
  "sem",
]);

const TERMOS_GENERICOS_CAPITALIZADOS = new Set([
  "caixa",
  "caneca",
  "kit",
  "modelo",
  "produto",
  "versao",
]);

export function normalizarMensagemDoTurno(body: string): string {
  return body
    .trim()
    .replace(/\s+/g, " ")
    .replace(EMOJI_FINAL, "")
    .trim()
    .toLocaleLowerCase("pt-BR");
}

export function paragrafosDaMensagem(body: string): string[] {
  const paragrafos = body
    .split(/\r?\n\s*\r?\n+/)
    .map((paragrafo) => paragrafo.trim())
    .filter((paragrafo) => paragrafo !== "");

  // Corpo vazio continua seguindo para os guardrails/canal como antes. O helper
  // só decide repetição, não passa a validar conteúdo por acidente.
  return paragrafos.length > 0 ? paragrafos : [body.trim()];
}

function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt-BR");
}

function tokensBrutos(texto: string): Set<string> {
  const tokens = semAcento(texto).match(/[a-z0-9]+(?:[.,:/-][a-z0-9]+)*/g) ?? [];
  return new Set(tokens);
}

function tokensSignificativos(texto: string): Set<string> {
  return new Set(
    [...tokensBrutos(texto)].filter((token) => !STOPWORDS_PT_BR.has(token) && token !== "r"),
  );
}

function numerosEValores(texto: string): string[] {
  return [...(semAcento(texto).match(/\d+(?:[.,:/-]\d+)*/g) ?? [])].sort();
}

function mesmosItens(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item, indice) => item === b[indice]);
}

function ePergunta(texto: string): boolean {
  const normalizado = semAcento(texto).trim();
  return texto.includes("?") || /^(?:qual|quais|como|quando|onde|por que|porque)\b/.test(normalizado);
}

function trocaTokenDistintivo(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (
    [...MARCADORES_UNILATERAIS_DE_SENTIDO].some(
      (token) => a.has(token) !== b.has(token),
    )
  ) {
    return true;
  }
  return GRUPOS_DISTINTIVOS.some((grupo) => {
    const emA = [...grupo].filter((token) => a.has(token));
    const emB = [...grupo].filter((token) => b.has(token));
    return emA.length > 0 && emB.length > 0 && !mesmosItens(emA.sort(), emB.sort());
  });
}

function nomesProprios(texto: string): Set<string> {
  const palavras = texto.match(/\p{L}[\p{L}'-]*/gu) ?? [];
  return new Set(
    palavras
      .filter((palavra, indice) => indice > 0 && /^\p{Lu}/u.test(palavra))
      .map(semAcento)
      .filter((palavra) => palavra.length > 1 && !TERMOS_GENERICOS_CAPITALIZADOS.has(palavra)),
  );
}

/**
 * Bloqueia troca de nome próprio sem impedir que a segunda formulação apenas
 * acrescente contexto. Ex.: `kit Casal` -> `Kit Afeto ... Casal` continua
 * comparável, mas `caneca Alice` -> `caneca Bruna` nunca é dedupe.
 */
function trocaNomeProprio(a: string, b: string): boolean {
  const nomesA = nomesProprios(a);
  const nomesB = nomesProprios(b);
  const exclusivosA = [...nomesA].filter((nome) => !nomesB.has(nome));
  const exclusivosB = [...nomesB].filter((nome) => !nomesA.has(nome));
  return exclusivosA.length > 0 && exclusivosB.length > 0;
}

/** Comparação determinística e conservadora, sem modelo de IA. */
export function paragrafosSaoSemelhantesNoTurno(a: string, b: string): boolean {
  if (normalizarMensagemDoTurno(a) === normalizarMensagemDoTurno(b)) return true;
  if (ePergunta(a) !== ePergunta(b)) return false;
  if (!mesmosItens(numerosEValores(a), numerosEValores(b))) return false;

  const tokensA = tokensSignificativos(a);
  const tokensB = tokensSignificativos(b);
  if (tokensA.size < 4 || tokensB.size < 4) return false;
  if (trocaTokenDistintivo(tokensBrutos(a), tokensBrutos(b))) return false;
  if (trocaNomeProprio(a, b)) return false;

  const menor = Math.min(tokensA.size, tokensB.size);
  const maior = Math.max(tokensA.size, tokensB.size);
  if (menor / maior < LIMIAR_SEMELHANCA_PARAGRAFO) return false;

  const intersecao = [...tokensA].filter((token) => tokensB.has(token)).length;
  return intersecao / menor >= LIMIAR_SEMELHANCA_PARAGRAFO;
}

function repetidoNoConjunto(paragrafo: string, vistos: ReadonlySet<string>): "identico" | "parecido" | null {
  const normalizado = normalizarMensagemDoTurno(paragrafo);
  if (vistos.has(normalizado)) return "identico";
  for (const visto of vistos) {
    if (paragrafosSaoSemelhantesNoTurno(paragrafo, visto)) return "parecido";
  }
  return null;
}

export function mensagemJaEnviadaNesteTurno(
  body: string,
  enviadas: ReadonlySet<string>,
): boolean {
  return paragrafosDaMensagem(body).every((paragrafo) => repetidoNoConjunto(paragrafo, enviadas));
}

export type ResultadoFiltroMensagemDoTurno =
  | {
      status: "duplicate_skipped";
      ok: true;
      paragrafos_recebidos: number;
      paragrafos_enviados: 0;
      paragrafos_repetidos_removidos: number;
      motivo?: "parecidos";
    }
  | {
      status: "pronta";
      body: string;
      paragrafos_recebidos: number;
      paragrafos_enviados: number;
      paragrafos_repetidos_removidos: number;
      motivo?: "parecidos";
    };

/**
 * Remove parágrafos idênticos ou semanticamente muito próximos por tokens no
 * mesmo turno. Valores, perguntas e alternativas distintivas fecham a trava.
 */
export function filtrarMensagemDoTurno(args: {
  body: string;
  enviadas: ReadonlySet<string>;
  log: Pick<Logger, "warn">;
}): ResultadoFiltroMensagemDoTurno {
  const paragrafos = paragrafosDaMensagem(args.body);
  const vistos = new Set(args.enviadas);
  let removeuParecido = false;
  const novos = paragrafos.filter((paragrafo) => {
    const normalizado = normalizarMensagemDoTurno(paragrafo);
    const repeticao = repetidoNoConjunto(paragrafo, vistos);
    if (repeticao !== null) {
      if (repeticao === "parecido") removeuParecido = true;
      return false;
    }
    vistos.add(normalizado);
    return true;
  });
  const removidos = paragrafos.length - novos.length;

  if (removidos > 0) {
    args.log.warn("parágrafos repetidos no mesmo turno não enviados", {
      paragrafos_recebidos: paragrafos.length,
      paragrafos_enviados: novos.length,
      paragrafos_repetidos_removidos: removidos,
      ...(removeuParecido ? { motivo: "parecidos" as const } : {}),
    });
  }

  if (novos.length === 0) {
    return {
      status: "duplicate_skipped",
      ok: true,
      paragrafos_recebidos: paragrafos.length,
      paragrafos_enviados: 0,
      paragrafos_repetidos_removidos: removidos,
      ...(removeuParecido ? { motivo: "parecidos" as const } : {}),
    };
  }

  return {
    status: "pronta",
    body: novos.join("\n\n"),
    paragrafos_recebidos: paragrafos.length,
    paragrafos_enviados: novos.length,
    paragrafos_repetidos_removidos: removidos,
    ...(removeuParecido ? { motivo: "parecidos" as const } : {}),
  };
}

export function resultadoDeEnvioSemRepeticao(
  filtro: ResultadoFiltroMensagemDoTurno,
): {
  ok: true;
  status: "enviado_sem_repeticao";
  paragrafos_repetidos_removidos: number;
  motivo?: "parecidos";
} | null {
  if (filtro.status !== "pronta" || filtro.paragrafos_repetidos_removidos === 0) return null;
  return {
    ok: true,
    status: "enviado_sem_repeticao",
    paragrafos_repetidos_removidos: filtro.paragrafos_repetidos_removidos,
    ...(filtro.motivo ? { motivo: filtro.motivo } : {}),
  };
}

export function registrarMensagemEnviadaNoTurno(body: string, enviadas: Set<string>): void {
  for (const paragrafo of paragrafosDaMensagem(body)) {
    enviadas.add(normalizarMensagemDoTurno(paragrafo));
  }
}
