import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import { ApiError } from "@/lib/api/types";
import type { HandlerCtx } from "@/lib/api/handlers/types";
import { capabilitiesOf, type ChannelProvider } from "@/lib/channels";
import { isMediaPathOwnedBy } from "@/lib/messaging/media/upload-validation";
import type { ForwardMessagesInput } from "@/lib/schemas";
import type { Message } from "@/lib/types/messaging";

const TIPOS_ENCAMINHAVEIS = new Set(["text", "image", "video", "document", "audio"]);
const COLUNAS_ORIGEM =
  "id, organization_id, conversation_id, type, status, body, media_mime, media_size_bytes, media_storage_path, sent_via, sent_at, metadata, revoked_at";

type ResultadoMensagem = {
  source_message_id: string;
  status: "sent" | "skipped" | "failed";
  message_id?: string;
  reason?: string;
};

export interface ResultadoDestino {
  conversation_id: string;
  status: "sent" | "partial" | "failed";
  messages: ResultadoMensagem[];
  reason?: string;
}

type MensagemOrigem = Pick<Message,
  | "id" | "organization_id" | "conversation_id" | "type" | "status"
  | "body" | "media_mime" | "media_size_bytes" | "media_storage_path"
  | "sent_via" | "sent_at" | "metadata" | "revoked_at"
>;

interface Destino {
  id: string;
  organization_id: string;
  channel_sessions: { provider: string } | null;
}

function uuidDeterministico(chave: string): string {
  const bytes = Buffer.from(createHash("sha256").update(chave).digest("hex").slice(0, 32), "hex");
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const h = bytes.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function extensaoDaMidia(path: string, mime: string | null): string {
  const encontrada = path.split("/").at(-1)?.match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toLowerCase();
  if (encontrada) return encontrada;
  const porMime: Record<string, string> = {
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
    "video/mp4": "mp4", "audio/ogg": "ogg", "audio/mpeg": "mp3",
    "application/pdf": "pdf",
  };
  return porMime[mime ?? ""] ?? "bin";
}

function erroEhDestinoExistente(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { statusCode?: string | number; message?: string; error?: string };
  const texto = `${e.error ?? ""} ${e.message ?? ""}`.toLowerCase();
  return String(e.statusCode ?? "") === "409" || texto.includes("already exists") || texto.includes("duplicate");
}

function motivoParaPular(m: MensagemOrigem): string | null {
  if (m.revoked_at) return "message_revoked";
  if (m.metadata?.internal_note === true || m.type === "internal_note") return "internal_note";
  if (m.metadata?.system_event === true || m.type === "system") return "system_event";
  if (m.status === "failed") return "message_failed";
  if (!TIPOS_ENCAMINHAVEIS.has(m.type)) return "unsupported_type";
  if (m.type === "text" && !m.body?.trim()) return "empty_message";
  return null;
}

const esperar = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function forwardMessagesHandler(
  supabase: SupabaseClient,
  admin: SupabaseClient,
  ctx: HandlerCtx,
  input: ForwardMessagesInput,
  deps: { sleep?: (ms: number) => Promise<void> } = {},
): Promise<{ destinations: ResultadoDestino[] }> {
  const idsOrigem = [...new Set(input.message_ids)];
  const idsDestino = [...new Set(input.destination_conversation_ids)];
  const forwardRequestId = input.request_id ?? randomUUID();

  const { data: origem, error: origemError } = await supabase
    .from("messages")
    .select(COLUNAS_ORIGEM)
    .eq("organization_id", ctx.organization_id)
    .in("id", idsOrigem);
  if (origemError) throw new ApiError(500, "internal_error", undefined, ctx.requestId, origemError.message);
  if ((origem ?? []).length !== idsOrigem.length) {
    throw new ApiError(403, "forbidden", undefined, ctx.requestId, "Mensagem de origem inexistente ou fora do seu acesso.");
  }

  const { data: destinos, error: destinosError } = await supabase
    .from("conversations")
    .select("id, organization_id, channel_sessions:channel_session_id(provider)")
    .eq("organization_id", ctx.organization_id)
    .in("id", idsDestino);
  if (destinosError) throw new ApiError(500, "internal_error", undefined, ctx.requestId, destinosError.message);
  if ((destinos ?? []).length !== idsDestino.length) {
    throw new ApiError(403, "forbidden", undefined, ctx.requestId, "Conversa de destino inexistente ou fora do seu acesso.");
  }

  const mensagens = (origem as unknown as MensagemOrigem[]).sort((a, b) =>
    a.sent_at.localeCompare(b.sent_at) || a.id.localeCompare(b.id),
  );
  const destinoPorId = new Map((destinos as unknown as Destino[]).map((d) => [d.id, d]));
  const resultados: ResultadoDestino[] = [];

  for (const destinationId of idsDestino) {
    const destino = destinoPorId.get(destinationId)!;
    const messages: ResultadoMensagem[] = [];
    let enviosNoDestino = 0;
    const pausaEntreEnvios = capabilitiesOf(destino.channel_sessions?.provider as ChannelProvider).banRisk;
    const idPorOrigem = new Map(
      mensagens.map((mensagem) => [
        mensagem.id,
        uuidDeterministico(`forward:${forwardRequestId}:${mensagem.id}:${destinationId}`),
      ]),
    );
    const { data: jaEncaminhadas, error: jaEncaminhadasError } = await supabase
      .from("messages")
      .select("id, status, error_code")
      .eq("organization_id", ctx.organization_id)
      .eq("conversation_id", destinationId)
      .in("id", [...idPorOrigem.values()]);
    if (jaEncaminhadasError) {
      resultados.push({
        conversation_id: destinationId,
        status: "failed",
        reason: "idempotency_lookup_failed",
        messages: mensagens.map((mensagem) => ({
          source_message_id: mensagem.id,
          status: "failed",
          reason: "idempotency_lookup_failed",
        })),
      });
      continue;
    }
    const existentePorId = new Map(
      ((jaEncaminhadas ?? []) as Array<{ id: string; status: string; error_code: string | null }>).map(
        (mensagem) => [mensagem.id, mensagem],
      ),
    );

    for (const origemMensagem of mensagens) {
      const motivo = motivoParaPular(origemMensagem);
      if (motivo) {
        messages.push({ source_message_id: origemMensagem.id, status: "skipped", reason: motivo });
        continue;
      }

      const chave = `forward:${forwardRequestId}:${origemMensagem.id}:${destinationId}`;
      const messageId = idPorOrigem.get(origemMensagem.id)!;
      const existente = existentePorId.get(messageId);
      if (existente) {
        messages.push(
          existente.status === "failed"
            ? { source_message_id: origemMensagem.id, status: "failed", message_id: existente.id, reason: existente.error_code ?? "send_failed" }
            : { source_message_id: origemMensagem.id, status: "sent", message_id: existente.id },
        );
        continue;
      }
      let mediaStoragePath: string | undefined;
      if (origemMensagem.type !== "text") {
        const sourcePath = origemMensagem.media_storage_path;
        if (!sourcePath || !isMediaPathOwnedBy(sourcePath, ctx.organization_id, origemMensagem.conversation_id)) {
          messages.push({ source_message_id: origemMensagem.id, status: "skipped", reason: "media_unavailable" });
          continue;
        }
        const ext = extensaoDaMidia(sourcePath, origemMensagem.media_mime);
        mediaStoragePath = `${ctx.organization_id}/${destinationId}/forward-${messageId}.${ext}`;
        const { error: copyError } = await admin.storage.from("whatsapp-media").copy(sourcePath, mediaStoragePath);
        if (copyError && !erroEhDestinoExistente(copyError)) {
          messages.push({ source_message_id: origemMensagem.id, status: "failed", reason: "media_copy_failed" });
          continue;
        }
      }

      if (enviosNoDestino > 0 && pausaEntreEnvios) await (deps.sleep ?? esperar)(1_000);
      try {
        const enviada = await sendMessageHandler(
          supabase,
          { ...ctx, internalMessageId: messageId, deduplicateInternalMessage: true },
          {
            conversation_id: destinationId,
            type: origemMensagem.type as "text" | "image" | "video" | "document" | "audio",
            ...(origemMensagem.body ? { body: origemMensagem.body } : {}),
            ...(mediaStoragePath ? {
              media_storage_path: mediaStoragePath,
              media_mime: origemMensagem.media_mime ?? undefined,
              media_size_bytes: origemMensagem.media_size_bytes ?? undefined,
            } : {}),
            metadata: {
              forwarded: true,
              forwarded_from_message_id: origemMensagem.id,
              idempotency_key: chave,
            },
          },
        );
        enviosNoDestino += 1;
        if (enviada.status === "failed") {
          messages.push({ source_message_id: origemMensagem.id, status: "failed", message_id: enviada.id, reason: enviada.error_code ?? "send_failed" });
        } else {
          messages.push({ source_message_id: origemMensagem.id, status: "sent", message_id: enviada.id });
        }
      } catch (error) {
        messages.push({
          source_message_id: origemMensagem.id,
          status: "failed",
          reason: error instanceof Error ? error.message : "send_failed",
        });
      }
    }

    const sent = messages.filter((m) => m.status === "sent").length;
    const failed = messages.filter((m) => m.status === "failed");
    resultados.push({
      conversation_id: destinationId,
      status: sent === messages.length ? "sent" : sent > 0 ? "partial" : "failed",
      messages,
      ...(failed[0]?.reason ? { reason: failed[0].reason } : {}),
    });
  }

  return { destinations: resultados };
}
