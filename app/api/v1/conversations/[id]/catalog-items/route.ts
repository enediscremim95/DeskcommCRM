import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { caminhoDaImagemDoCatalogo } from "@/lib/catalogo/caminho-da-imagem";
import { montarLegendaDoProduto } from "@/lib/catalogo/mensagem-do-produto";
import { materializarFotoDoCatalogo } from "@/lib/catalogo/materializar-foto";
import { estadoDaJanela } from "@/lib/channels/janela";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { traduzir } from "@/lib/i18n/dicionario";
import { createAdminClient } from "@/lib/supabase/admin";
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
    .select("id, last_inbound_at, channel_sessions:channel_session_id(provider)")
    .eq("organization_id", authz.org.orgId)
    .eq("id", conversationId)
    .maybeSingle();
  if (conversaError)
    return fail("internal_error", t("Erro ao validar conversa."), 500, { requestId });
  if (!conversa) return fail("not_found", t("Conversa não encontrada."), 404, { requestId });
  const canal = conversa.channel_sessions as unknown as { provider: string } | null;
  if (estadoDaJanela(canal?.provider, conversa.last_inbound_at, new Date()).tipo === "fechada") {
    return fail(
      "window_closed",
      t("A janela de 24 horas está fechada. Envie um modelo aprovado."),
      409,
      { requestId },
    );
  }

  const { data: produtos, error: produtosError } = await supabase
    .from("catalog_products")
    .select("id, nome, descricao, preco_cents, moeda, imagem_url, legenda_atendimento")
    .eq("organization_id", authz.org.orgId)
    .eq("ativo", true)
    .in("id", parsed.data.product_ids);
  if (produtosError)
    return fail("internal_error", t("Erro ao ler o catálogo."), 500, { requestId });
  const porId = new Map((produtos ?? []).map((produto) => [produto.id, produto]));
  const admin = createAdminClient();
  const resultados: Array<{
    product_id: string;
    status: "sent" | "queued" | "failed";
    message_id?: string;
    reason?: string;
  }> = [];

  for (const productId of parsed.data.product_ids) {
    const produto = porId.get(productId);
    if (!produto) {
      resultados.push({ product_id: productId, status: "failed", reason: "product_not_found" });
      continue;
    }
    const legenda = montarLegendaDoProduto(produto);
    let mediaStoragePath: string | undefined;
    let mediaMime: string | undefined;
    let mediaSizeBytes: number | undefined;
    try {
      const origem = caminhoDaImagemDoCatalogo(produto.imagem_url, authz.org.orgId, produto.id);
      if (origem) {
        const materializada = await materializarFotoDoCatalogo(
          admin,
          authz.org.orgId,
          conversationId,
          {
            storage_path: origem,
            mime_type: origem.endsWith(".png") ? "image/png" : "image/jpeg",
            size_bytes: 1,
          },
        );
        mediaStoragePath = materializada.storagePath;
        mediaMime = materializada.mime;
        mediaSizeBytes = materializada.sizeBytes;
      }
      const mensagem = await sendMessageHandler(
        supabase,
        {
          organization_id: authz.org.orgId,
          actor: { type: "user", id: authz.user.id },
          requestId,
          idioma: authz.user.idioma,
        },
        {
          conversation_id: conversationId,
          type: mediaStoragePath ? "image" : "text",
          body: legenda,
          ...(mediaStoragePath
            ? {
                media_storage_path: mediaStoragePath,
                media_mime: mediaMime,
                media_size_bytes: mediaSizeBytes,
              }
            : {}),
        },
      );
      if (mensagem.status === "failed") {
        resultados.push({
          product_id: productId,
          status: "failed",
          message_id: mensagem.id,
          reason: mensagem.error_code ?? "send_failed",
        });
      } else {
        resultados.push({
          product_id: productId,
          status: mensagem.status === "queued" ? "queued" : "sent",
          message_id: mensagem.id,
        });
      }
    } catch (error) {
      resultados.push({
        product_id: productId,
        status: "failed",
        reason: error instanceof Error ? error.message : "send_failed",
      });
    }
  }

  const enviados = resultados.filter((resultado) => resultado.status === "sent").length;
  const emFila = resultados.filter((resultado) => resultado.status === "queued").length;
  const falhas = resultados.filter((resultado) => resultado.status === "failed").length;
  return ok(
    {
      total: resultados.length,
      sent: enviados,
      queued: emFila,
      failed: falhas,
      results: resultados,
    },
    { status: 201, requestId },
  );
}
