import { caminhoDaImagemDoCatalogoNaOrganizacao } from "@/lib/catalogo/caminho-da-imagem";

export interface ProdutoComFotoDoCatalogo {
  id: string;
  imagem_url: string | null;
  produto_codigo: string | null;
}

export interface FotoDaGaleriaDoCatalogo {
  produto_codigo: string;
  posicao: number;
  storage_path: string;
  mime_type: string;
}

export interface FotoResolvidaDoCatalogo {
  storage_path: string;
  mime_type: "image/jpeg" | "image/png";
  nome_do_arquivo: string;
}

function mimeDoCaminho(caminho: string): "image/jpeg" | "image/png" {
  return caminho.toLocaleLowerCase("pt-BR").endsWith(".png") ? "image/png" : "image/jpeg";
}

function nomeDoArquivo(caminho: string, productId: string): string {
  const ultimoSegmento = caminho.split("/").at(-1)?.replace(/[\p{Cc}"\\]/gu, "_").trim();
  return ultimoSegmento || `produto-${productId}.${mimeDoCaminho(caminho) === "image/png" ? "png" : "jpg"}`;
}

export function primeirasFotosPorCodigo(
  fotos: FotoDaGaleriaDoCatalogo[],
): Map<string, FotoDaGaleriaDoCatalogo> {
  const primeiraPorCodigo = new Map<string, FotoDaGaleriaDoCatalogo>();
  for (const foto of fotos) {
    if (!primeiraPorCodigo.has(foto.produto_codigo)) {
      primeiraPorCodigo.set(foto.produto_codigo, foto);
    }
  }
  return primeiraPorCodigo;
}

/** Replica a prioridade da rota de envio: imagem_url válida, senão primeira foto da galeria. */
export function resolverFotoDoProduto(
  produto: ProdutoComFotoDoCatalogo,
  organizationId: string,
  primeiraFotoPorCodigo: Map<string, FotoDaGaleriaDoCatalogo>,
): FotoResolvidaDoCatalogo | null {
  if (produto.imagem_url?.trim()) {
    const caminho = caminhoDaImagemDoCatalogoNaOrganizacao(produto.imagem_url, organizationId);
    if (!caminho) return null;
    return {
      storage_path: caminho,
      mime_type: mimeDoCaminho(caminho),
      nome_do_arquivo: nomeDoArquivo(caminho, produto.id),
    };
  }

  const galeria = produto.produto_codigo
    ? primeiraFotoPorCodigo.get(produto.produto_codigo)
    : undefined;
  if (!galeria || !galeria.storage_path.startsWith(`${organizationId}/`)) return null;
  const mime = galeria.mime_type === "image/png" ? "image/png" : "image/jpeg";
  return {
    storage_path: galeria.storage_path,
    mime_type: mime,
    nome_do_arquivo: nomeDoArquivo(galeria.storage_path, produto.id),
  };
}
