import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { fail, noContent, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { traduzir } from "@/lib/i18n/dicionario";
import {
  MAX_WHATSAPP_IMAGE_BYTES,
  validarMidiaDeAtalho,
} from "@/lib/messaging/media/channel-limits";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

function caminhoDaImagem(url: string | null): string | null {
  if (!url) return null;
  const marcador = "/storage/v1/object/public/catalog-media/";
  const indice = url.indexOf(marcador);
  if (indice < 0) return null;
  return decodeURIComponent(url.slice(indice + marcador.length));
}

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "catalog_products" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: produto } = await supabase
    .from("catalog_products")
    .select("id, imagem_url")
    .eq("organization_id", authz.org.orgId)
    .eq("id", id)
    .maybeSingle();
  if (!produto) return fail("not_found", t("Produto não encontrado."), 404, { requestId });

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_WHATSAPP_IMAGE_BYTES + 1_048_576) {
    return fail("payload_too_large", t("A imagem precisa ter até 5 MB."), 413, { requestId });
  }
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return fail("validation_failed", t("Escolha uma imagem."), 422, { requestId });
  }
  const verdict = validarMidiaDeAtalho(file.type, file.size);
  if (!verdict.ok || verdict.kind !== "image") {
    const code = verdict.ok ? "unsupported_media_type" : verdict.code;
    const message = verdict.ok ? "Use uma imagem JPEG ou PNG." : verdict.message;
    const status =
      code === "payload_too_large" ? 413 : code === "unsupported_media_type" ? 415 : 422;
    return fail(code, t(message), status, { requestId });
  }

  const extensao = file.type === "image/png" ? "png" : "jpg";
  const caminho = `${authz.org.orgId}/${id}/${randomUUID()}.${extensao}`;
  const admin = createAdminClient();
  const { error: uploadError } = await admin.storage
    .from("catalog-media")
    .upload(caminho, Buffer.from(await file.arrayBuffer()), {
      contentType: file.type,
      upsert: false,
    });
  if (uploadError) {
    return fail("internal_error", t("Erro ao guardar a imagem."), 500, { requestId });
  }
  const { data: publica } = admin.storage.from("catalog-media").getPublicUrl(caminho);
  const { data, error } = await supabase
    .from("catalog_products")
    .update({ imagem_url: publica.publicUrl })
    .eq("organization_id", authz.org.orgId)
    .eq("id", id)
    .select("id, imagem_url")
    .maybeSingle();
  if (error || !data) {
    await admin.storage.from("catalog-media").remove([caminho]);
    return fail("internal_error", t("Erro ao vincular a imagem."), 500, { requestId });
  }
  const anterior = caminhoDaImagem(produto.imagem_url);
  if (anterior?.startsWith(`${authz.org.orgId}/${id}/`)) {
    await admin.storage.from("catalog-media").remove([anterior]);
  }
  await audit({
    action: "catalog_product.updated",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "catalog_products",
    resourceId: id,
    requestId,
    metadata: { change: "image_updated", media_size_bytes: file.size },
  });
  return ok(data, { requestId });
}

export async function DELETE(_req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "catalog_products" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: produto } = await supabase
    .from("catalog_products")
    .select("id, imagem_url")
    .eq("organization_id", authz.org.orgId)
    .eq("id", id)
    .maybeSingle();
  if (!produto?.imagem_url) {
    return fail("not_found", t("Imagem não encontrada."), 404, { requestId });
  }
  const { data, error } = await supabase
    .from("catalog_products")
    .update({ imagem_url: null })
    .eq("organization_id", authz.org.orgId)
    .eq("id", id)
    .not("imagem_url", "is", null)
    .select("id, imagem_url")
    .maybeSingle();
  if (error) return fail("internal_error", t("Erro ao remover a imagem."), 500, { requestId });
  if (!data) return fail("not_found", t("Imagem não encontrada."), 404, { requestId });
  const anterior = caminhoDaImagem(produto.imagem_url);
  if (anterior?.startsWith(`${authz.org.orgId}/${id}/`)) {
    await createAdminClient().storage.from("catalog-media").remove([anterior]);
  }
  await audit({
    action: "catalog_product.updated",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "catalog_products",
    resourceId: id,
    requestId,
    metadata: { change: "image_removed" },
  });
  return noContent(requestId);
}
