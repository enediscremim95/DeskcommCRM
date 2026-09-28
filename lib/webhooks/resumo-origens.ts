export interface LinhaDeCaptacaoParaResumo {
  utm: unknown;
  fields: unknown;
  origin: string | null;
}

export interface ItemDoResumo {
  valor: string | null;
  total: number;
}

export interface ResumoDeOrigens {
  total: number;
  sem_marcacao: number;
  por_utm_source: ItemDoResumo[];
  por_utm_campaign: ItemDoResumo[];
  por_pagina: ItemDoResumo[];
}

function objeto(valor: unknown): Record<string, unknown> {
  return valor && typeof valor === "object" && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : {};
}

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() ? valor.trim() : null;
}

function somar(mapa: Map<string | null, number>, valor: string | null): void {
  mapa.set(valor, (mapa.get(valor) ?? 0) + 1);
}

function ordenar(mapa: Map<string | null, number>): ItemDoResumo[] {
  return [...mapa.entries()]
    .map(([valor, total]) => ({ valor, total }))
    .sort(
      (a, b) =>
        b.total - a.total || (a.valor ?? "").localeCompare(b.valor ?? "", "pt-BR"),
    );
}

/** Agrega somente linhas que a rota já filtrou como leads criados nos últimos 30 dias. */
export function resumirOrigens(linhas: LinhaDeCaptacaoParaResumo[]): ResumoDeOrigens {
  const sources = new Map<string | null, number>();
  const campaigns = new Map<string | null, number>();
  const paginas = new Map<string | null, number>();
  let semMarcacao = 0;

  for (const linha of linhas) {
    const marcacao = objeto(linha.utm);
    const campos = objeto(linha.fields);
    const temUtm = Object.entries(marcacao).some(
      ([chave, valor]) => chave.toLowerCase().startsWith("utm_") && texto(valor) !== null,
    );
    if (!temUtm) semMarcacao += 1;

    somar(sources, texto(marcacao.utm_source));
    somar(campaigns, texto(marcacao.utm_campaign));
    somar(
      paginas,
      texto(marcacao.pagina) ??
        texto(marcacao.origem) ??
        texto(campos.pagina) ??
        texto(campos.origem) ??
        texto(linha.origin),
    );
  }

  return {
    total: linhas.length,
    sem_marcacao: semMarcacao,
    por_utm_source: ordenar(sources),
    por_utm_campaign: ordenar(campaigns),
    por_pagina: ordenar(paginas),
  };
}
