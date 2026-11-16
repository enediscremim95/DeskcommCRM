const MARCADOR_CATALOGO = "/storage/v1/object/public/catalog-media/";

function extrairCaminhoDoCatalogo(url: string | null | undefined): string | null {
  if (!url) return null;
  let pathnameNormalizado: string;
  try {
    pathnameNormalizado = new URL(url).pathname;
  } catch {
    return null;
  }
  if (!pathnameNormalizado.includes(MARCADOR_CATALOGO)) return null;

  // `URL.pathname` normaliza `/./` e `/../` antes de devolver o valor. A
  // validação de posse precisa enxergar o caminho bruto para não transformar
  // traversal em um objeto aparentemente legítimo da organização.
  const indice = url.indexOf(MARCADOR_CATALOGO);
  if (indice < 0) return null;
  const inicio = indice + MARCADOR_CATALOGO.length;
  const limites = [url.indexOf("?", inicio), url.indexOf("#", inicio)].filter(
    (limite) => limite >= 0,
  );
  const fim = limites.length > 0 ? Math.min(...limites) : url.length;

  try {
    const caminho = decodeURIComponent(url.slice(inicio, fim));
    if (/[\\\p{Cc}]/u.test(caminho)) return null;
    if (caminho.split("/").some((segmento) => !segmento || segmento === "." || segmento === "..")) {
      return null;
    }
    return caminho;
  } catch {
    return null;
  }
}

/**
 * Extrai somente objetos do bucket que pertencem à organização autenticada.
 * URL externa e caminho de outra organização são tratados como produto sem foto.
 */
export function caminhoDaImagemDoCatalogo(
  url: string | null | undefined,
  organizationId: string,
  productId: string,
): string | null {
  const caminho = extrairCaminhoDoCatalogo(url);
  if (!caminho) return null;
  const prefixo = `${organizationId}/${productId}/`;
  return caminho.startsWith(prefixo) ? caminho : null;
}

/**
 * Variante de leitura para envio. Aceita qualquer objeto da organização no
 * bucket, inclusive a pasta do SKU pai criada pela importação do painel.
 */
export function caminhoDaImagemDoCatalogoNaOrganizacao(
  url: string | null | undefined,
  organizationId: string,
): string | null {
  const caminho = extrairCaminhoDoCatalogo(url);
  if (!caminho) return null;
  return caminho.startsWith(`${organizationId}/`) ? caminho : null;
}

export function imagemEhDoCatalogoGerenciado(
  url: string | null | undefined,
  organizationId?: string,
): boolean {
  const caminho = extrairCaminhoDoCatalogo(url);
  if (!caminho) return false;
  if (!organizationId) return true;
  return caminho.startsWith(`${organizationId}/`);
}
