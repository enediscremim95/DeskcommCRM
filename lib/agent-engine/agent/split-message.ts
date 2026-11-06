export interface SplitIntoBubblesOptions {
  /** Cada parágrafo vira uma mensagem física. Ausente/false preserva o legado. */
  splitPorParagrafo?: boolean;
}

/**
 * Quebra o texto da resposta em "bolhas" curtas (Onda 4).
 *
 * O modo legado junta unidades adjacentes até o teto. O modo opt-in por
 * parágrafo mantém cada bloco separado e só corta um bloco que excede o teto,
 * preferindo pontuação de frase, depois vírgula e só então palavra.
 */
export function splitIntoBubbles(
  text: string,
  maxChars: number,
  options: SplitIntoBubblesOptions = {},
): string[] {
  const trimmed = (text ?? "").trim();
  if (trimmed === "") return [];
  if (options.splitPorParagrafo === true) {
    return splitPreservandoParagrafos(trimmed, maxChars);
  }

  return splitLegado(trimmed, maxChars);
}

/** Mantido isolado para o opt-in não alterar nenhuma organização por acidente. */
function splitLegado(trimmed: string, maxChars: number): string[] {
  if (trimmed.length <= maxChars) return [trimmed];

  // Unidades atômicas: parágrafos → sentenças. Cada unidade que ainda estoura é
  // quebrada por palavra.
  const units: string[] = [];
  for (const para of trimmed.split(/\n{2,}/)) {
    const p = para.trim();
    if (p === "") continue;
    if (p.length <= maxChars) {
      units.push(p);
      continue;
    }
    for (const sentence of splitSentences(p)) {
      if (sentence.length <= maxChars) units.push(sentence);
      else units.push(...splitWords(sentence, maxChars));
    }
  }

  // Junta unidades adjacentes enquanto couberem (com espaço).
  const bubbles: string[] = [];
  let cur = "";
  for (const u of units) {
    const joined = cur === "" ? u : `${cur} ${u}`;
    if (joined.length <= maxChars) {
      cur = joined;
    } else {
      if (cur !== "") bubbles.push(cur);
      cur = u;
    }
  }
  if (cur !== "") bubbles.push(cur);
  return bubbles;
}

function splitPreservandoParagrafos(text: string, maxChars: number): string[] {
  const bubbles: string[] = [];
  for (const raw of text.split(/\n\s*\n+/)) {
    const paragrafo = raw.trim();
    if (paragrafo === "") continue;
    bubbles.push(...splitParagrafoLongo(paragrafo, maxChars));
  }
  return bubbles;
}

/**
 * Corta um único parágrafo sem remontar pedaços depois. Assim, um corte por
 * palavra nunca é juntado à frase seguinte sem a pontuação que o texto tinha.
 */
function splitParagrafoLongo(paragrafo: string, maxChars: number): string[] {
  if (paragrafo.length <= maxChars) return [paragrafo];

  const out: string[] = [];
  let restante = paragrafo;
  while (restante.length > maxChars) {
    const corte = melhorCorte(restante, maxChars);
    if (corte === null) {
      // Palavra atômica maior que o teto: preserva inteira, como no legado.
      const primeiroEspaco = restante.search(/\s/);
      if (primeiroEspaco === -1) {
        out.push(restante);
        restante = "";
        break;
      }
      out.push(restante.slice(0, primeiroEspaco).trim());
      restante = restante.slice(primeiroEspaco).trimStart();
      continue;
    }

    const pedaco = restante.slice(0, corte).trim();
    if (pedaco !== "") out.push(pedaco);
    restante = restante.slice(corte).trimStart();
  }
  if (restante.trim() !== "") out.push(restante.trim());
  return out;
}

/** Retorna o índice exclusivo do melhor limite dentro do teto. */
function melhorCorte(texto: string, maxChars: number): number | null {
  const limite = Math.min(maxChars, texto.length);
  let frase: number | null = null;
  let virgula: number | null = null;

  for (let i = 0; i < limite; i++) {
    const atual = texto[i]!;
    const anterior = texto[i - 1];
    const seguinte = texto[i + 1];
    const entreDigitos =
      anterior !== undefined &&
      seguinte !== undefined &&
      /\d/.test(anterior) &&
      /\d/.test(seguinte);

    if ((atual === "." || atual === "!" || atual === "?" || atual === "…") && !entreDigitos) {
      frase = i + 1;
    } else if (atual === "," && !entreDigitos) {
      virgula = i + 1;
    }
  }

  if (frase !== null) return frase;
  if (virgula !== null) return virgula;

  const janela = texto.slice(0, limite + 1);
  const ultimoEspaco = Math.max(janela.lastIndexOf(" "), janela.lastIndexOf("\n"), janela.lastIndexOf("\t"));
  return ultimoEspaco > 0 ? ultimoEspaco : null;
}

/**
 * Divide em sentenças mantendo a pontuação final (. ! ?).
 *
 * O "." NÃO conta como fim de frase quando está entre dois dígitos — separador
 * de milhar/decimal brasileiro ("R$ 10.990,00", "12.990"). Sem esta guarda,
 * TODO preço em reais virava duas "sentenças" ("R$ 10." e "990 no cartão…"),
 * que a bolha seguinte às vezes junta com espaço espúrio ("R$ 7. 990") e às
 * vezes manda em bolhas do WhatsApp SEPARADAS — e um cliente que só via a
 * primeira lia "R$ 10" como preço fechado de um produto de R$ 10.990.
 * Medido em produção (YADEA, 2026-09-04): a moto DT3 (R$ 10.990) anunciada
 * como "R$ 10" reais.
 */
function splitSentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  const re = /[.!?]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const end = m.index + m[0].length;
    const prevChar = text[m.index - 1];
    const nextChar = text[end];
    const isNumeroPartido =
      m[0] === "." &&
      prevChar !== undefined &&
      nextChar !== undefined &&
      /\d/.test(prevChar) &&
      /\d/.test(nextChar);
    if (isNumeroPartido) continue;
    out.push(text.slice(start, end).trim());
    start = end;
  }
  const resto = text.slice(start).trim();
  if (resto !== "") out.push(resto);
  return out.length > 0 ? out.filter((s) => s !== "") : [text];
}

/** Última linha de defesa: agrupa palavras até maxChars; palavra atômica > max vai sozinha. */
function splitWords(text: string, maxChars: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const w of text.split(/\s+/)) {
    if (w === "") continue;
    const joined = cur === "" ? w : `${cur} ${w}`;
    if (joined.length <= maxChars) cur = joined;
    else {
      if (cur !== "") out.push(cur);
      cur = w;
    }
  }
  if (cur !== "") out.push(cur);
  return out;
}

/**
 * Outcome mínimo que o send do canal devolve (subconjunto usado aqui).
 * messageId casa com o shape real de ChannelSendResult (string | null | undefined
 * conforme o kind) — não apenas string opcional.
 */
export interface BubbleOutcome {
  kind: string;
  messageId?: string | null;
}

export interface SendInBubblesOpts<T extends BubbleOutcome = BubbleOutcome> {
  enabled: boolean;
  maxChars: number;
  /** Opt-in: não junta parágrafos distintos na mesma mensagem física. */
  splitPorParagrafo?: boolean;
  send: (body: string) => Promise<T>;
  sleep: (ms: number) => Promise<void>;
  /** ms de jitter humano entre bolhas (só entre, não antes da 1ª). */
  jitter: () => number;
  /**
   * Roda UMA vez, antes do 1º envio, recebendo a 1ª bolha — é o gancho do
   * atraso humano do turno ("digitando…" + espera proporcional; ver
   * `atraso-humano.ts`).
   *
   * Recebe a 1ª BOLHA, não o corpo inteiro, e a diferença é a que se vê no
   * aparelho: quem escreve em bolhas manda a primeira assim que ela fica
   * pronta, não depois de digitar as cinco. Dimensionar a espera pelo corpo
   * todo faria uma resposta longa e picotada ficar parada no teto antes da
   * primeira palavra aparecer.
   *
   * UMA vez, e não por bolha, porque entre bolhas já existe o jitter anti-ban:
   * chamá-lo a cada uma somaria duas esperas na mesma pausa.
   *
   * OPCIONAL — sem ele o comportamento é exatamente o de antes, que é o que
   * mantém os testes existentes intactos. Chamador de produção há UM só
   * (`inbound-turn.ts`); o turno de follow-up NÃO passa por aqui — ele fala com
   * `channel.send` direto (`followup-turn.ts:604`), então a mensagem proativa
   * segue saindo sem pausa humana. É escopo deliberado: o "rápido demais" que
   * este gancho conserta é o da RESPOSTA que chega junto com o "✓✓" do cliente,
   * e um follow-up não responde a nada que ele acabou de mandar.
   */
  antesDaPrimeira?: (primeiraBolha: string) => Promise<void>;
}

/**
 * Envia o corpo em bolhas quando `enabled`; senão um envio só. Cada bolha passa
 * pelo mesmo `send` (que no runtime é o channel.send pós-guardrails, com seq++).
 * Para no 1º outcome que não seja de sucesso ('sent'/'already_sent'/'queued')
 * e o devolve — não segue mandando bolha após veto/bloqueio/falha.
 *
 * LIMITAÇÃO CONHECIDA: o contador de cap diário do pacing anti-ban (recordSend)
 * conta o send lógico UMA vez por turno, então um turno de N bolhas avança o cap
 * em 1, não N — aceitável por ora (doutrina: "anti-ban gateia uma vez"); revisitar
 * se o warm-up precisar de precisão por mensagem física.
 */
const OK_KINDS = new Set(["sent", "already_sent", "queued"]);

export async function sendInBubbles<T extends BubbleOutcome>(
  body: string,
  opts: SendInBubblesOpts<T>,
): Promise<T> {
  const bubbles = opts.enabled
    ? splitIntoBubbles(body, opts.maxChars, {
        splitPorParagrafo: opts.splitPorParagrafo ?? false,
      })
    : [body];
  if (bubbles.length === 0) return opts.send(body); // corpo vazio: deixa o canal decidir
  let last: T | undefined;
  for (let i = 0; i < bubbles.length; i++) {
    // Antes da 1ª: o atraso humano do turno. Entre as demais: o jitter anti-ban
    // que já existia. Nunca os dois na mesma pausa.
    if (i === 0) await opts.antesDaPrimeira?.(bubbles[0]!);
    else await opts.sleep(opts.jitter());
    last = await opts.send(bubbles[i]!);
    if (!OK_KINDS.has(last.kind)) return last; // veto/bloqueio/falha: para aqui
  }
  return last!;
}
