import { LIMITE_LEGENDA_DE_MIDIA } from "@/lib/channels/limites-de-legenda";

interface ProdutoParaMensagem {
  nome: string;
  preco_cents: number;
  moeda: string;
  descricao: string | null;
  legenda_atendimento?: string | null;
}

const DESCRICAO_MAX = 220;

function normalizarTextoCompleto(texto: string | null | undefined): string | null {
  const normalizado = (texto ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((linha) => linha.replace(/[ \t]+/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
  return normalizado.trim() ? normalizado : null;
}

function descricaoCurta(descricao: string | null): string | null {
  const limpa = descricao?.replace(/\s+/g, " ").trim() ?? "";
  if (!limpa) return null;
  if (limpa.length <= DESCRICAO_MAX) return limpa;
  return `${limpa.slice(0, DESCRICAO_MAX - 1).trimEnd()}…`;
}

/** Texto que acompanha a foto do produto. Nunca usa custo ou estoque interno. */
export function montarLegendaDoProduto(produto: ProdutoParaMensagem): string {
  const preco = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: produto.moeda,
  }).format(produto.preco_cents / 100);
  const cabecalho = [produto.nome.trim(), preco].join("\n");
  const personalizada = produto.legenda_atendimento?.replace(/\s+/g, " ").trim() ?? "";
  if (!personalizada) {
    return [cabecalho, descricaoCurta(produto.descricao)]
      .filter((parte): parte is string => Boolean(parte))
      .join("\n")
      .slice(0, LIMITE_LEGENDA_DE_MIDIA);
  }

  const disponivel = LIMITE_LEGENDA_DE_MIDIA - cabecalho.length - 1;
  if (disponivel <= 0) return cabecalho.slice(0, LIMITE_LEGENDA_DE_MIDIA);
  const final =
    personalizada.length <= disponivel
      ? personalizada
      : `${personalizada.slice(0, Math.max(0, disponivel - 1)).trimEnd()}…`;
  return `${cabecalho}\n${final}`;
}

/**
 * Rascunho humano do produto. Preserva parágrafos e nunca corta conteúdo:
 * quem atende decide o que remover antes de enviar pela porta central.
 */
export function montarLegendaCompletaDoProduto(
  produto: ProdutoParaMensagem,
): { texto: string; excedeLimite: boolean } {
  const preco = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: produto.moeda,
  }).format(produto.preco_cents / 100);
  const cabecalho = [produto.nome.trim(), preco].join("\n");
  const personalizada = normalizarTextoCompleto(produto.legenda_atendimento);
  const descricao = personalizada ?? normalizarTextoCompleto(produto.descricao);
  const texto = [cabecalho, descricao].filter(Boolean).join("\n");
  return { texto, excedeLimite: texto.length > LIMITE_LEGENDA_DE_MIDIA };
}
