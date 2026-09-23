/**
 * Os parâmetros de campanha escondidos dentro da URL da página.
 *
 * Quem chega por anúncio traz `?utm_source=fb&utm_campaign=...&utm_content=...`
 * grudado no endereço, e a ficha mostrava só o endereço cortado ("...utm_sour…").
 * Aqui a URL vira linhas com nome, para bater o olho e conferir a campanha.
 */
const CHAVES = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "campaign_name",
  "adset_name",
  "ad_name",
  "campaign_id",
  "adset_id",
  "ad_id",
  "gclid",
  "fbclid",
] as const;

export function extrairUtmsDaUrl(valor: unknown): Record<string, string> {
  if (typeof valor !== "string") return {};
  const texto = valor.trim();
  if (!/^https?:\/\//i.test(texto) || !texto.includes("?")) return {};
  let params: URLSearchParams;
  try {
    params = new URL(texto).searchParams;
  } catch {
    return {};
  }
  const achados: Record<string, string> = {};
  for (const chave of CHAVES) {
    const bruto = params.get(chave);
    if (!bruto) continue;
    // "CP1%20-%20CONVERS%C3%83O" já chega decodificado pelo URLSearchParams;
    // o "+" do formulário vira espaço, e valor vazio não entra.
    const limpo = bruto.trim();
    if (limpo) achados[chave] = limpo;
  }
  return achados;
}

/**
 * Junta o que já está separado (`source_metadata`) com o que estava preso na
 * URL. O que já veio separado MANDA: é o dado que a captação gravou de propósito.
 */
export function origemComUtms(
  metadata: Record<string, unknown> | null | undefined,
  camposComUrl: unknown[],
): Array<[string, unknown]> {
  const daUrl: Record<string, string> = {};
  for (const campo of camposComUrl) {
    Object.assign(daUrl, extrairUtmsDaUrl(campo));
  }
  const juntos: Record<string, unknown> = { ...daUrl };
  for (const [chave, valor] of Object.entries(metadata ?? {})) {
    if (valor === null || valor === undefined || valor === "") continue;
    juntos[chave] = valor;
  }
  return Object.entries(juntos);
}
