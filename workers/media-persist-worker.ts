/**
 * Consome `media.persist_requested`: baixa o binário da mídia (MediaSource
 * WAHA) e persiste no bucket privado `whatsapp-media`, preenchendo
 * media_storage_path/media_size_bytes na linha de `messages`.
 * Retry/backoff é responsabilidade do drain (`lib/event-log/drain.ts`), não
 * deste handler: aqui só retornamos `status:"error"` em falha. O drain conta
 * `attempts` e dead-letra a partir do próprio `MAX_ATTEMPTS`; espelhamos esse
 * valor localmente (`DRAIN_MAX_ATTEMPTS`) só para saber quando é a ÚLTIMA
 * tentativa que o drain vai permitir. Nesse ponto marca
 * `metadata.media_status = "failed"` e abre um aviso visível na Central;
 * evento `done` sem arquivo não pode ser a evidência final de uma persistência.
 */
import type { EventRow, HandlerResult } from "@/lib/event-log/dispatcher";
import {
  CHANNEL_SESSION_REF_COLUMNS,
  DEFAULT_CHANNEL_PROVIDER,
  getAdapter,
  resolveSessionRef,
  type ChannelProvider,
  type ChannelSessionRef,
} from "@/lib/channels";
import { storagePathFor } from "@/lib/messaging/media/types";
import { TIPOS_DERIVAVEIS } from "@/lib/messaging/media/derivable";
import {
  deveGuardarMidiaRecebida,
  MEDIA_STATUS_NOT_STORED,
} from "@/lib/messaging/media/retention";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const MEDIA_PERSIST_CONSUMER_KEY = "media_persist_v1";
// Espelha MAX_ATTEMPTS de lib/event-log/drain.ts (não exportado de lá).
// `row.attempts` chega ao handler como a contagem ANTES do incremento do
// drain; o drain dead-letra quando `row.attempts + 1 >= DRAIN_MAX_ATTEMPTS`,
// ou seja, a última tentativa que o drain ainda vai permitir é
// `row.attempts === DRAIN_MAX_ATTEMPTS - 1`.
const DRAIN_MAX_ATTEMPTS = 5;

interface MessageMediaRow {
  channel_session_id: string;
  id: string;
  organization_id: string;
  conversation_id: string;
  type: string;
  media_url: string | null;
  media_mime: string | null;
  media_storage_path: string | null;
  metadata: Record<string, unknown> | null;
}

export async function persistMessageMedia(row: EventRow): Promise<HandlerResult> {
  const consumer_key = MEDIA_PERSIST_CONSUMER_KEY;
  const messageId = (row.payload.message_id as string | undefined) ?? row.entity_id;
  if (!messageId) return { consumer_key, status: "skipped", detail: "no message_id" };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("messages")
    // `channel_session_id` entra no select porque é ele que resolve QUEM baixa.
    // Sem a coluna, o worker não tem como pedir o adapter e voltaria a
    // depender de uma função fixa de um canal só.
    .select(
      "id, organization_id, conversation_id, channel_session_id, type, media_url, media_mime, media_storage_path, metadata",
    )
    .eq("id", messageId)
    .eq("organization_id", row.organization_id)
    .maybeSingle();
  if (error) return { consumer_key, status: "error", detail: error.message };

  const msg = data as MessageMediaRow | null;
  // A mensagem pode ter sido removida por LGPD entre emissão e consumo. Não há
  // mais entidade nem arquivo a persistir, então este é um skip legítimo.
  if (!msg) return { consumer_key, status: "skipped", detail: "message not found" };
  if (msg.media_storage_path) return { consumer_key, status: "skipped", detail: "already stored" };

  const isLastAttempt = row.attempts >= DRAIN_MAX_ATTEMPTS - 1;

  const markStatus = async (media_status: "stored" | "failed", patch: Record<string, unknown> = {}) => {
    const { error: updErr } = await admin
      .from("messages")
      .update({ metadata: { ...(msg.metadata ?? {}), media_status }, ...patch })
      .eq("id", msg.id)
      .eq("organization_id", msg.organization_id);
    if (updErr) throw new Error(`message update failed: ${updErr.message}`);
  };

  const avisarFalhaDefinitiva = async (): Promise<void> => {
    try {
      const { data: jaAberto, error: buscaError } = await admin
        .from("agent_inbox_items")
        .select("id")
        .eq("organization_id", msg.organization_id)
        .eq("kind", "event_dead")
        .eq("ref_kind", "conversation")
        .eq("ref_id", msg.conversation_id)
        .eq("status", "open")
        .limit(1)
        .maybeSingle();
      if (buscaError) {
        logger.warn("[media-persist] não consegui conferir aviso existente", {
          organization_id: msg.organization_id,
          message_id: msg.id,
          detail: buscaError.message,
        });
      }
      if (jaAberto) return;

      const tipo = ({
        image: "foto",
        audio: "áudio",
        video: "vídeo",
        sticker: "figurinha",
        document: "documento",
      } as Record<string, string>)[msg.type] ?? "mídia";
      const { error: inboxError } = await admin.from("agent_inbox_items").insert({
        organization_id: msg.organization_id,
        kind: "event_dead",
        severity: "critical",
        title: "Um arquivo recebido não ficou disponível na conversa",
        body: `O arquivo de ${tipo} não pôde ser guardado após ${DRAIN_MAX_ATTEMPTS} tentativas. Abra a conversa e confira a conexão do WhatsApp e o Storage antes de pedir ao cliente que envie novamente.`,
        ref_kind: "conversation",
        ref_id: msg.conversation_id,
      });
      if (inboxError) {
        logger.error("[media-persist] aviso na Central falhou", {
          organization_id: msg.organization_id,
          message_id: msg.id,
          detail: inboxError.message,
        });
      }
    } catch (err) {
      logger.error("[media-persist] não consegui abrir o aviso de falha definitiva", {
        organization_id: msg.organization_id,
        message_id: msg.id,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const falhar = async (detail: string): Promise<HandlerResult> => {
    if (isLastAttempt) {
      logger.error("[media-persist] persistência falhou definitivamente", {
        message_id: msg.id,
        detail,
      });
      try {
        await markStatus("failed");
      } catch (statusError) {
        logger.error("[media-persist] não consegui marcar a mídia como failed", {
          organization_id: msg.organization_id,
          message_id: msg.id,
          detail: statusError instanceof Error ? statusError.message : String(statusError),
        });
      }
      await avisarFalhaDefinitiva();
    }
    return { consumer_key, status: "error", detail };
  };

  // `media.persist_requested` afirma que existe um arquivo para guardar. URL
  // ausente não é decisão benignamente pulada: sem erro o drain gravava `done`
  // e produzia exatamente a falsa evidência observada em produção.
  if (!msg.media_url) return falhar("media_url ausente");

  const { data: organization, error: organizationError } = await admin
    .from("organizations")
    .select("settings")
    .eq("id", msg.organization_id)
    .maybeSingle();

  if (organizationError) {
    return falhar(`falha ao ler política de mídia: ${organizationError.message}`);
  }

  const storageEnabled = deveGuardarMidiaRecebida(organization?.settings);

  if (!storageEnabled) {
    const derivable = TIPOS_DERIVAVEIS.has(msg.type);
    const { error: discardError } = await admin
      .from("messages")
      .update({
        metadata: { ...(msg.metadata ?? {}), media_status: MEDIA_STATUS_NOT_STORED },
        media_storage_path: null,
        media_size_bytes: null,
        // Tipos deriváveis conservam o ponteiro somente até o worker baixar os
        // bytes em memória. Os demais o descartam já nesta operação.
        ...(!derivable ? { media_url: null } : {}),
      })
      .eq("id", msg.id)
      .eq("organization_id", msg.organization_id);
    if (discardError) return { consumer_key, status: "error", detail: discardError.message };

    if (!derivable) {
      return { consumer_key, status: "ok", detail: "storage disabled; binary discarded" };
    }

    const { error: emitErr } = await admin.rpc("emit_event" as never, {
      p_event_type: "media.derive_requested",
      p_entity_kind: "message",
      p_entity_id: msg.id,
      p_payload: { message_id: msg.id },
      p_metadata: { source: "media_persist", transient: true },
      p_organization_id: msg.organization_id,
    } as never);
    if (emitErr) return { consumer_key, status: "error", detail: emitErr.message };

    return { consumer_key, status: "ok", detail: "storage disabled; transient derivation requested" };
  }

  let media;
  try {
    // Pelo ADAPTER, não por uma função fixa. Antes esta linha era
    // `fetchWahaMedia(...)` direto: mídia recebida por qualquer outro canal
    // virava linha SEM bytes, e o atendente via "imagem" sem imagem. Medido em
    // produção: 423 persistências no canal por QR, ZERO no intermediado.
    //
    // O worker não pergunta QUAL canal é — o invariante 1 proíbe e o
    // `lint:channels` reprova. Ele pede a sessão, pede o adapter e testa a
    // presença do método.
    const { data: sessao } = await admin
      .from("channel_sessions")
      .select(`provider, ${CHANNEL_SESSION_REF_COLUMNS}`)
      .eq("organization_id", msg.organization_id)
      .eq("id", msg.channel_session_id)
      .maybeSingle();

    const adapter = getAdapter(
      ((sessao?.provider as string) ?? DEFAULT_CHANNEL_PROVIDER) as ChannelProvider,
    );
    const sessionRef = sessao ? resolveSessionRef(sessao as unknown as ChannelSessionRef) : null;
    if (!sessionRef) {
      return falhar("sessão do canal indisponível para baixar a mídia");
    }
    if (!adapter.fetchInboundMedia) {
      // Canal que não sabe baixar não é erro: é o estado normal de um canal sem
      // mídia de entrada. Marcar `failed` faria a Central acusar um defeito que
      // não existe.
      return { consumer_key, status: "skipped", detail: "canal_sem_midia_de_entrada" };
    }

    media = await adapter.fetchInboundMedia({
      organizationId: msg.organization_id,
      sessionRef,
      url: msg.media_url,
      hintMime: msg.media_mime,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return falhar(detail);
  }

  const path = storagePathFor(msg.organization_id, msg.conversation_id, msg.id, media.mime);
  const { error: uploadErr } = await admin.storage
    .from("whatsapp-media")
    .upload(path, media.buffer, { contentType: media.mime, upsert: true });
  if (uploadErr) {
    return falhar(uploadErr.message);
  }

  try {
    await markStatus("stored", {
      media_storage_path: path,
      media_size_bytes: media.buffer.byteLength,
      media_mime: media.mime,
    });
  } catch (err) {
    return falhar(err instanceof Error ? err.message : String(err));
  }

  // Dispara a derivação textual (Onda 3) — fire-and-forget, mesmo padrão do
  // resto do repo: falha de emit não reverte a persistência já concluída.
  const { error: emitErr } = await admin.rpc("emit_event" as never, {
    p_event_type: "media.derive_requested",
    p_entity_kind: "message",
    p_entity_id: msg.id,
    p_payload: { message_id: msg.id },
    p_metadata: { source: "media_persist" },
    p_organization_id: msg.organization_id,
  } as never);
  if (emitErr) logger.warn("[media-persist] emit_event failed (non-blocking)", { message_id: msg.id, detail: emitErr.message });

  return { consumer_key, status: "ok" };
}
