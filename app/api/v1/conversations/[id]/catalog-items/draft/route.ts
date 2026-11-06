import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import {
  primeirasFotosPorCodigo,
  resolverFotoDoProduto,
  type FotoDaGaleriaDoCatalogo,
} from "@/lib/catalogo/foto-do-produto";
import { montarLegendaCompletaDoProduto } from "@/lib/catalogo/mensagem-do-produto";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { traduzir } from "@/lib/i18n/dicionario";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const schema = z.object({ product_ids: z.array(z.string().uuid()).min(1).max(10) });

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "messages" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", t("Escolha de 1 a 10 produtos."), 422, { requestId });
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

  const { data: produtos, error: produtosError } = await supabase
    .from("catalog_products")
    .select(
      "id, nome, descricao, preco_cents, moeda, imagem_url, legenda_atendimento, produto_codigo",
    )
    .eq("organization_id", authz.org.orgId)
    .eq("ativo", true)
    .in("id", parsed.data.product_ids);
  if (produtosError) {
    return fail("internal_error", t("Erro ao ler o catálogo."), 500, { requestId });
  }
  const porId = new Map((produtos ?? []).map((produto) => [produto.id, produto]));
  if (parsed.data.product_ids.some((productId) => !porId.has(productId))) {
    return fail("not_found", t("Produto não encontrado."), 404, { requestId });
  }

  const codigosDaGaleria = [
    ...new Set(
      (produtos ?? []).flatMap((produto) =>
        !produto.imagem_url?.trim() && produto.produto_codigo ? [produto.produto_codigo] : [],
      ),
    ),
  ];
  let fotosDaGaleria: FotoDaGaleriaDoCatalogo[] = [];
  if (codigosDaGaleria.length > 0) {
    const { data: fotos, error: fotosError } = await supabase
      .from("catalog_product_images")
      .select("produto_codigo, posicao, storage_path, mime_type")
      .eq("organization_id", authz.org.orgId)
      .in("produto_codigo", codigosDaGaleria)
      .order("posicao", { ascending: true });
    if (fotosError) {
      return fail("internal_error", t("Erro ao ler as fotos do catálogo."), 500, { requestId });
    }
    fotosDaGaleria = (fotos ?? []) as FotoDaGaleriaDoCatalogo[];
  }
  const primeiraFotoPorCodigo = primeirasFotosPorCodigo(fotosDaGaleria);

  const resultados = parsed.data.product_ids.map((productId) => {
    const produto = porId.get(productId)!;
    const legenda = montarLegendaCompletaDoProduto(produto);
    const fotoResolvida = resolverFotoDoProduto(
      produto,
      authz.org.orgId,
      primeiraFotoPorCodigo,
    );
    return {
      product_id: produto.id,
      nome: produto.nome,
      legenda: legenda.texto,
      excede_limite: legenda.excedeLimite,
      foto: fotoResolvida
        ? {
            url: `/api/v1/conversations/${conversationId}/catalog-items/photo?product_id=${encodeURIComponent(produto.id)}`,
            mime: fotoResolvida.mime_type,
            nome_do_arquivo: fotoResolvida.nome_do_arquivo,
          }
        : null,
    };
  });

  return ok(resultados, { requestId });
}
