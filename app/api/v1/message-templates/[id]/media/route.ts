import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { fail, noContent, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { traduzir } from "@/lib/i18n/dicionario";
import {
  MAX_WHATSAPP_VIDEO_BYTES,
  validarMidiaDeAtalho,
} from "@/lib/messaging/media/channel-limits";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "message_templates" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("message_templates")
    .select("media_storage_path, media_mime_type, media_file_name" as string)
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();
  const media = data as unknown as {
    media_storage_path: string | null;
    media_mime_type: string | null;
    media_file_name: string | null;
  } | null;
  if (!media?.media_storage_path || !media.media_mime_type) {
    return fail("not_found", t("Mídia não encontrada."), 404, { requestId });
  }

  const { data: arquivo, error } = await createAdminClient()
    .storage.from("whatsapp-media")
    .download(media.media_storage_path);
  if (error || !arquivo) {
    return fail("not_found", t("Mídia não encontrada."), 404, { requestId });
  }
  const nome = (media.media_file_name ?? "midia").replace(/["\r\n]/g, "");
  return new Response(await arquivo.arrayBuffer(), {
    headers: {
      "Content-Type": media.media_mime_type,
      "Content-Disposition": `inline; filename="${nome}"`,
      "Cache-Control": "private, max-age=300",
      "X-Request-Id": requestId,
    },
  });
}

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "message_templates" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: template } = await supabase
    .from("message_templates")
    .select("id, owner_user_id")
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();
  if (!template) return fail("not_found", t("Template não encontrado."), 404, { requestId });
  if (template.owner_user_id !== null) {
    return fail(
      "validation_failed",
      t("Mídia é permitida apenas em resposta compartilhada."),
      422,
      { requestId },
    );
  }

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_WHATSAPP_VIDEO_BYTES + 1_048_576) {
    return fail("payload_too_large", t("O arquivo precisa ter até 16 MB."), 413, {
      requestId,
    });
  }
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return fail("validation_failed", t("Escolha uma imagem ou um vídeo."), 422, {
      requestId,
    });
  }
  const verdict = validarMidiaDeAtalho(file.type, file.size);
  if (!verdict.ok) {
    const status =
      verdict.code === "payload_too_large"
        ? 413
        : verdict.code === "unsupported_media_type"
          ? 415
          : 422;
    return fail(verdict.code, t(verdict.message), status, { requestId });
  }

  const extensao =
    verdict.kind === "image"
      ? file.type === "image/png"
        ? "png"
        : "jpg"
      : file.type === "video/3gpp"
        ? "3gp"
        : "mp4";
  const caminho = `${authz.org.orgId}/templates/${id}/${verdict.kind}-${randomUUID()}.${extensao}`;
  const admin = createAdminClient();
  const { error: uploadError } = await admin.storage
    .from("whatsapp-media")
    .upload(caminho, Buffer.from(await file.arrayBuffer()), {
      contentType: file.type,
      upsert: false,
    });
  if (uploadError) {
    return fail("internal_error", t("Erro ao guardar a mídia."), 500, { requestId });
  }

  const { data, error } = await supabase
    .from("message_templates")
    .update({
      media_storage_path: caminho,
      media_mime_type: file.type,
      media_file_name: file.name.slice(0, 180) || `midia.${extensao}`,
      media_size_bytes: file.size,
      media_kind: verdict.kind,
      audio_storage_path: null,
      audio_mime_type: null,
      audio_file_name: null,
      audio_size_bytes: null,
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .is("owner_user_id", null)
    .select("id, media_mime_type, media_file_name, media_size_bytes, media_kind" as string)
    .maybeSingle();
  if (error || !data) {
    await admin.storage.from("whatsapp-media").remove([caminho]);
    return fail("internal_error", t("Erro ao vincular a mídia."), 500, { requestId });
  }

  void audit({
    action: "template.updated",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "message_template",
    resourceId: id,
    requestId,
    metadata: { change: "media_updated", media_kind: verdict.kind, media_size_bytes: file.size },
  });
  return ok(data, { requestId });
}

export async function DELETE(_req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "message_templates" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("message_templates")
    .update({
      media_storage_path: null,
      media_mime_type: null,
      media_file_name: null,
      media_size_bytes: null,
      media_kind: null,
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .is("owner_user_id", null)
    .not("media_storage_path", "is", null)
    .select("id")
    .maybeSingle();
  if (error) return fail("internal_error", t("Erro ao remover a mídia."), 500, { requestId });
  if (!data) return fail("not_found", t("Mídia não encontrada."), 404, { requestId });
  void audit({
    action: "template.updated",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "message_template",
    resourceId: id,
    requestId,
    metadata: { change: "media_removed" },
  });
  return noContent(requestId);
}
