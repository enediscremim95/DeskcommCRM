import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import {
  primeirasFotosPorCodigo,
  resolverFotoDoProduto,
  type FotoDaGaleriaDoCatalogo,
} from "@/lib/catalogo/foto-do-produto";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { traduzir } from "@/lib/i18n/dicionario";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const productIdSchema = z.string().uuid();

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "messages" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const parsedProductId = productIdSchema.safeParse(req.nextUrl.searchParams.get("product_id"));
  if (!parsedProductId.success) {
    return fail("validation_failed", t("Produto inválido."), 422, { requestId });
  }

  const { id: conversationId } = await ctx.params;
  const supabase = await createClient();
  const { data: conversa, error: conversaError } = await supabase
    .from("conversations")
    .select("id")
    .eq("organization_id", authz.org.orgId)
    .eq("id", conversationId)
    .maybeSingle();
  if (conversaError) {
    return fail("internal_error", t("Erro ao validar conversa."), 500, { requestId });
  }
  if (!conversa) return fail("not_found", t("Conversa não encontrada."), 404, { requestId });

  const { data: produto, error: produtoError } = await supabase
    .from("catalog_products")
    .select("id, imagem_url, produto_codigo")
    .eq("organization_id", authz.org.orgId)
    .eq("ativo", true)
    .eq("id", parsedProductId.data)
    .maybeSingle();
  if (produtoError) {
    return fail("internal_error", t("Erro ao ler o catálogo."), 500, { requestId });
  }
  if (!produto) return fail("not_found", t("Produto não encontrado."), 404, { requestId });

  let fotosDaGaleria: FotoDaGaleriaDoCatalogo[] = [];
  if (!produto.imagem_url?.trim() && produto.produto_codigo) {
    const { data: fotos, error: fotosError } = await supabase
      .from("catalog_product_images")
      .select("produto_codigo, posicao, storage_path, mime_type")
      .eq("organization_id", authz.org.orgId)
      .eq("produto_codigo", produto.produto_codigo)
      .order("posicao", { ascending: true });
    if (fotosError) {
      return fail("internal_error", t("Erro ao ler as fotos do catálogo."), 500, { requestId });
    }
    fotosDaGaleria = (fotos ?? []) as FotoDaGaleriaDoCatalogo[];
  }
  const foto = resolverFotoDoProduto(
    produto,
    authz.org.orgId,
    primeirasFotosPorCodigo(fotosDaGaleria),
  );
  if (!foto) return fail("not_found", t("Foto do produto não encontrada."), 404, { requestId });

  const { data: arquivo, error: downloadError } = await createAdminClient().storage
    .from("catalog-media")
    .download(foto.storage_path);
  if (downloadError || !arquivo) {
    return fail("not_found", t("Foto do produto não encontrada."), 404, { requestId });
  }

  return new Response(arquivo, {
    status: 200,
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `inline; filename="${foto.nome_do_arquivo}"`,
      "Content-Type": foto.mime_type,
      "X-Content-Type-Options": "nosniff",
      "X-Request-Id": requestId,
    },
  });
}
