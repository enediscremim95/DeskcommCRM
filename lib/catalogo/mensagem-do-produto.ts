import { LIMITE_LEGENDA_DE_MIDIA } from "@/lib/channels/limites-de-legenda";

interface ProdutoParaMensagem {
  nome: string;
  preco_cents: number;
  moeda: string;
  descricao: string | null;
  legenda_atendimento?: string | null;
}

const DESCRICAO_MAX = 220;

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
