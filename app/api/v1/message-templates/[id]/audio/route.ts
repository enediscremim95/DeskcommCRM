import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { fail, noContent, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { traduzir } from "@/lib/i18n/dicionario";
import { logger } from "@/lib/logger";
import {
  ConversaoDeVozFalhou,
  converterAudioParaVozOpus,
} from "@/lib/messaging/media/voice-transcode";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
const MAX_AUDIO_BYTES = 16 * 1024 * 1024;

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
    .select("audio_storage_path")
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();
  if (!data?.audio_storage_path) {
    return fail("not_found", t("Áudio não encontrado."), 404, { requestId });
  }
  const { data: arquivo, error } = await createAdminClient()
    .storage.from("whatsapp-media")
    .download(data.audio_storage_path);
  if (error || !arquivo)
    return fail("not_found", t("Áudio não encontrado."), 404, { requestId });
  return new Response(await arquivo.arrayBuffer(), {
    headers: {
      "Content-Type": "audio/ogg; codecs=opus",
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
      t("Áudio é permitido apenas em resposta compartilhada."),
      422,
      { requestId },
    );
  }

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_AUDIO_BYTES + 1_048_576) {
    return fail("payload_too_large", t("O áudio precisa ter até 16 MB."), 413, { requestId });
  }
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || !file.type.toLowerCase().startsWith("audio/")) {
    return fail("unsupported_media_type", t("Escolha um arquivo de áudio."), 415, { requestId });
  }
  if (file.size <= 0 || file.size > MAX_AUDIO_BYTES) {
    return fail("payload_too_large", t("O áudio precisa ter até 16 MB."), 413, { requestId });
  }

  let voz: Awaited<ReturnType<typeof converterAudioParaVozOpus>>;
  try {
    voz = await converterAudioParaVozOpus({
      buffer: Buffer.from(await file.arrayBuffer()),
      mime: file.type,
    });
  } catch (error) {
    if (error instanceof ConversaoDeVozFalhou) {
      return fail("unsupported_media_type", t(error.message), 415, { requestId });
    }
    throw error;
  }

  const caminho = `${authz.org.orgId}/templates/${id}/voz-${randomUUID()}.ogg`;
  const admin = createAdminClient();
  const { error: uploadError } = await admin.storage
    .from("whatsapp-media")
    .upload(caminho, voz.buffer, { contentType: voz.mime, upsert: false });
  if (uploadError) {
    logger.error("[message-templates.audio] upload falhou", {
      requestId,
      detail: uploadError.message,
    });
    return fail("internal_error", t("Erro ao guardar o áudio."), 500, { requestId });
  }

  const { data, error } = await supabase
    .from("message_templates")
    .update({
      audio_storage_path: caminho,
      audio_mime_type: voz.mime,
      audio_file_name: file.name.slice(0, 180) || "voz.ogg",
      audio_size_bytes: voz.buffer.length,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .is("owner_user_id", null)
    .select("id, audio_mime_type, audio_file_name, audio_size_bytes")
    .maybeSingle();
  if (error || !data) {
    await admin.storage.from("whatsapp-media").remove([caminho]);
    return fail("internal_error", t("Erro ao vincular o áudio."), 500, { requestId });
  }
  void audit({
    action: "template.updated",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "message_template",
    resourceId: id,
    requestId,
    metadata: {
      change: "audio_updated",
      media_mime: voz.mime,
      media_size_bytes: voz.buffer.length,
    },
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
      audio_storage_path: null,
      audio_mime_type: null,
      audio_file_name: null,
      audio_size_bytes: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .is("owner_user_id", null)
    .not("audio_storage_path", "is", null)
    .select("id")
    .maybeSingle();
  if (error) return fail("internal_error", t("Erro ao remover o áudio."), 500, { requestId });
  if (!data) return fail("not_found", t("Áudio não encontrado."), 404, { requestId });
  void audit({
    action: "template.updated",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "message_template",
    resourceId: id,
    requestId,
    metadata: { change: "audio_removed" },
  });
  return noContent(requestId);
}
