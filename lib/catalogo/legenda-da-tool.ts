export interface LinhaDePrecoParaLegenda {
  codigo: string;
  nome: string;
  descricao: string | null;
  opcao_preco: string | null;
  preco_cents: number;
  moeda: string;
}

function limpar(texto: string): string {
  return texto
    .replace(/[*_~`#>]/g, "")
    .replace(/[—–]/g, ",")
    .replace(/\s+/g, " ")
    .trim();
}

function moeda(cents: number, currency: string): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(cents / 100);
}

function ehCabecalho(linha: string): boolean {
  const letras = linha.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ]/g, "");
  return (
    letras.length >= 3 &&
    letras === letras.toLocaleUpperCase("pt-BR") &&
    letras !== letras.toLocaleLowerCase("pt-BR")
  );
}

function cortarNoLimiteDePalavra(texto: string, limite: number): string {
  if (texto.length <= limite) return texto;
  const recorte = texto.slice(0, limite + 1);
  const ultimoEspaco = recorte.lastIndexOf(" ");
  return recorte.slice(0, ultimoEspaco > 0 ? ultimoEspaco : limite).trim();
}

function resumirParagrafo(texto: string, limite = 220): string {
  const limpo = limpar(texto);
  if (limpo.length <= limite) return limpo;
  const dentroDoLimite = limpo.slice(0, limite);
  const finais = [...dentroDoLimite.matchAll(/[.!?](?=\s|$)/g)];
  const ultimoFim = finais.at(-1)?.index;
  if (ultimoFim !== undefined) return dentroDoLimite.slice(0, ultimoFim + 1).trim();
  const semFraseCompleta = cortarNoLimiteDePalavra(limpo, limite - 1);
  return `${semFraseCompleta.replace(/[,:;]$/, "")}.`;
}

function primeiroParagrafoReal(descricao: string | null): string | null {
  if (!descricao) return null;
  const linhas = descricao.split(/\r?\n/).map((linha) => linha.trim());
  const paragrafo: string[] = [];
  for (const linha of linhas) {
    if (!linha) {
      if (paragrafo.length > 0) break;
      continue;
    }
    if (/^(DETALHES|PRAZOS E ENVIO)$/i.test(linha)) break;
    if (ehCabecalho(linha)) {
      if (paragrafo.length > 0) break;
      continue;
    }
    paragrafo.push(linha);
  }
  return paragrafo.length > 0 ? resumirParagrafo(paragrafo.join(" ")) : null;
}

export function montarLegendaDaTool(
  selecionada: LinhaDePrecoParaLegenda,
  opcoes: LinhaDePrecoParaLegenda[],
): string {
  const linhas = [cortarNoLimiteDePalavra(limpar(selecionada.nome), 90)];
  if (selecionada.opcao_preco) linhas.push(limpar(selecionada.opcao_preco));
  linhas.push(moeda(selecionada.preco_cents, selecionada.moeda));
  if (opcoes.length > 1) {
    linhas.push("Outras opções:");
    const outras = opcoes.filter((opcao) => opcao.codigo !== selecionada.codigo);
    for (const opcao of outras.slice(0, 3)) {
      linhas.push(`${limpar(opcao.opcao_preco ?? opcao.codigo)}: ${moeda(opcao.preco_cents, opcao.moeda)}`);
    }
    if (outras.length > 3) {
      const restantes = outras.length - 3;
      linhas.push(`e mais ${restantes} ${restantes === 1 ? "opção" : "opções"}`);
    }
  }
  const descricao = primeiroParagrafoReal(selecionada.descricao);
  if (descricao) linhas.push(descricao);
  return linhas.join("\n").slice(0, 1024);
}
