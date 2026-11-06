const MARCADOR_CATALOGO = "/storage/v1/object/public/catalog-media/";

/**
 * Extrai somente objetos do bucket que pertencem à organização autenticada.
 * URL externa e caminho de outra organização são tratados como produto sem foto.
 */
export function caminhoDaImagemDoCatalogo(
  url: string | null | undefined,
  organizationId: string,
  productId?: string,
): string | null {
  if (!url) return null;
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  const indice = pathname.indexOf(MARCADOR_CATALOGO);
  if (indice < 0) return null;
  let caminho: string;
  try {
    caminho = decodeURIComponent(pathname.slice(indice + MARCADOR_CATALOGO.length));
  } catch {
    return null;
  }
  const prefixo = productId ? `${organizationId}/${productId}/` : `${organizationId}/`;
  return caminho.startsWith(prefixo) ? caminho : null;
}

export function imagemEhDoCatalogoGerenciado(
  url: string | null | undefined,
  organizationId?: string,
): boolean {
  if (!url) return false;
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return false;
  }
  const indice = pathname.indexOf(MARCADOR_CATALOGO);
  if (indice < 0) return false;
  if (!organizationId) return true;
  try {
    const caminho = decodeURIComponent(pathname.slice(indice + MARCADOR_CATALOGO.length));
    return caminho.startsWith(`${organizationId}/`);
  } catch {
    return false;
  }
}
