interface ProdutoParaMensagem {
  nome: string;
  preco_cents: number;
  moeda: string;
  descricao: string | null;
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
  return [produto.nome.trim(), preco, descricaoCurta(produto.descricao)]
    .filter((parte): parte is string => Boolean(parte))
    .join("\n");
}
