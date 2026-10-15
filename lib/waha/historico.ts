import type { SupabaseClient } from "@supabase/supabase-js";

import {
  encontrarContatoPorLid,
  encontrarContatoPorTelefone,
} from "@/lib/channels/contato-por-telefone";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getWahaClient,
  type WahaClient,
  type WahaHistoryResult,
} from "@/lib/waha/client";
import type { WahaPayload } from "@/lib/waha/envelope";
import {
  bodyOf,
  mediaFilenameOf,
  mediaMimeOf,
  parseChatId,
  previewFromMessage,
  resolveMessageType,
  telefoneAlternativoDe,
} from "@/lib/waha/ingest";
import { resolveWahaChatId } from "@/lib/waha/send";

type Admin = ReturnType<typeof createAdminClient>;
type JsonObject = Record<string, unknown>;

export const LIMITE_POR_CHAT = 200;
export const LIMITE_DE_CHATS_POR_RODADA = 20;
export const JANELA_RECENTE_MS = 30 * 24 * 60 * 60_000;

interface SessaoHistorico {
  id: string;
  organization_id: string;
  waha_session_name: string;
  metadata: JsonObject;
}

interface ContatoHistorico {
  id: string;
  phone_number?: string | null;
  wa_identity?: string | null;
  wa_lid?: string | null;
}

export interface ResultadoImportacao {
  status: "ok" | "store_desligado" | "nao_configurado";
  inseridas: number;
  duplicadas: number;
  ignoradas: number;
  conversationId?: string;
}

export interface ResultadoRodadaHistorico {
  status: "ok" | "desligado" | "nao_configurado";
  chatsProcessados: number;
  mensagensInseridas: number;
  efeitosPorOrganizacao: Record<string, number>;
}

function objeto(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function instanteDaMensagem(p: WahaPayload): string | null {
  if (typeof p.timestamp !== "number" || !Number.isFinite(p.timestamp) || p.timestamp <= 0) return null;
  const millis = p.timestamp > 10_000_000_000 ? p.timestamp : p.timestamp * 1000;
  const data = new Date(millis);
  return Number.isNaN(data.getTime()) ? null : data.toISOString();
}

function ehMidia(p: WahaPayload): boolean {
  return p.hasMedia === true || ["image", "video", "audio", "document", "sticker"]
    .includes(resolveMessageType(p));
}

async function conversaExistenteOuHistorica(
  admin: Admin,
  sessao: SessaoHistorico,
  contatoId: string,
): Promise<{ id: string; metadata: JsonObject } | null> {
  const ler = () => admin
    .from("conversations")
    .select("id, metadata")
    .eq("organization_id", sessao.organization_id)
    .eq("contact_id", contatoId)
    .eq("channel_session_id", sessao.id)
    .eq("is_group", false)
    .maybeSingle();

  const existente = await ler();
  if (existente.error) throw new Error(`historico_conversation_read:${existente.error.message}`);
  if (existente.data) {
    return { id: existente.data.id, metadata: objeto(existente.data.metadata) };
  }

  const criada = await admin
    .from("conversations")
    .insert({
      organization_id: sessao.organization_id,
      contact_id: contatoId,
      channel_session_id: sessao.id,
      channel: "whatsapp",
      is_group: false,
      status: "open",
      metadata: { historico: true },
    })
    .select("id, metadata")
    .maybeSingle();
  if (!criada.error && criada.data) {
    return { id: criada.data.id, metadata: objeto(criada.data.metadata) };
  }
  if (criada.error?.code !== "23505") {
    throw new Error(`historico_conversation_insert:${criada.error?.message ?? "sem linha"}`);
  }
  const vencedora = await ler();
  if (vencedora.error || !vencedora.data) throw new Error("historico_conversation_race_sem_vencedora");
  return { id: vencedora.data.id, metadata: objeto(vencedora.data.metadata) };
}

async function marcarProjecao(
  admin: Admin,
  sessao: SessaoHistorico,
  conversationId: string,
  direction: "inbound" | "outbound",
  preview: string,
  at: string,
): Promise<void> {
  const { error } = await admin.rpc("fn_mark_historical_conversation_message" as never, {
    p_org: sessao.organization_id,
    p_conv: conversationId,
    p_direction: direction,
    p_preview: preview,
    p_at: at,
  } as never);
  if (error) throw new Error(`historico_projection:${error.message}`);
}

/** Persiste somente fatos de conversa. Não chama o pipeline de entrada ao vivo. */
export async function importarPayloadsSilenciosamente(input: {
  admin: Admin;
  sessao: SessaoHistorico;
  contato: ContatoHistorico;
  payloads: WahaPayload[];
  desde?: Date;
  registrarOffset?: number;
}): Promise<ResultadoImportacao> {
  const conversa = await conversaExistenteOuHistorica(input.admin, input.sessao, input.contato.id);
  if (!conversa) return { status: "ok", inseridas: 0, duplicadas: 0, ignoradas: input.payloads.length };

  let inseridas = 0;
  let duplicadas = 0;
  let ignoradas = 0;
  const ordenadas = [...input.payloads]
    .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
    .slice(0, LIMITE_POR_CHAT)
    .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  for (const p of ordenadas) {
    const sentAt = instanteDaMensagem(p);
    if (!p.id || !sentAt || (input.desde && new Date(sentAt) < input.desde)) {
      ignoradas++;
      continue;
    }
    const texto = bodyOf(p);
    if (!texto && !ehMidia(p)) {
      ignoradas++;
      continue;
    }
    const direction = p.fromMe === true ? "outbound" : "inbound";
    const media = ehMidia(p);
    const filename = mediaFilenameOf(p);
    const { error } = await input.admin.from("messages").insert({
      organization_id: input.sessao.organization_id,
      conversation_id: conversa.id,
      channel_session_id: input.sessao.id,
      contact_id: input.contato.id,
      external_id: p.id,
      type: resolveMessageType(p),
      direction,
      status: direction === "outbound" ? "sent" : "delivered",
      ack: p.ack ?? null,
      body: texto,
      media_url: null,
      media_mime: mediaMimeOf(p),
      sent_via: "external_device",
      sent_at: sentAt,
      delivered_at: direction === "inbound" ? sentAt : null,
      metadata: {
        historico: true,
        origem: "historico_canal",
        raw_type: p.type,
        ...(media ? {
          media_status: "not_stored",
          media_not_stored_reason: "anterior a conexao",
        } : {}),
        ...(filename ? { media_filename: filename } : {}),
      },
    });
    if (error?.code === "23505") {
      duplicadas++;
      continue;
    }
    if (error) throw new Error(`historico_message_insert:${error.message}`);
    inseridas++;
    await marcarProjecao(
      input.admin,
      input.sessao,
      conversa.id,
      direction,
      previewFromMessage(p),
      sentAt,
    );
  }
  if (input.registrarOffset !== undefined) {
    const atual = Number.isInteger(conversa.metadata.historico_offset)
      ? Number(conversa.metadata.historico_offset)
      : 0;
    await input.admin.from("conversations").update({
      metadata: {
        ...conversa.metadata,
        historico_offset: Math.max(atual, input.registrarOffset),
      },
    }).eq("id", conversa.id).eq("organization_id", input.sessao.organization_id);
  }
  return { status: "ok", inseridas, duplicadas, ignoradas, conversationId: conversa.id };
}

export async function contatoDoChat(
  admin: Admin,
  organizationId: string,
  chatId: string,
): Promise<ContatoHistorico | null> {
  const identidade = parseChatId(chatId);
  if (identidade.kind === "phone" && identidade.phone) {
    return encontrarContatoPorTelefone(admin as unknown as SupabaseClient, organizationId, identidade.phone);
  }
  if (identidade.kind === "lid" && identidade.lid) {
    return encontrarContatoPorLid(admin as unknown as SupabaseClient, organizationId, identidade.lid);
  }
  return null;
}

async function mensagensDoChat(
  client: WahaClient,
  sessao: SessaoHistorico,
  chatId: string,
  offset: number,
): Promise<WahaHistoryResult<WahaPayload[]>> {
  return client.getChatMessages(sessao.waha_session_name, chatId, {
    limit: LIMITE_POR_CHAT,
    offset,
    downloadMedia: false,
  });
}

export function proximoCursorHistorico(cursor: number, chatsRecebidos: number): number {
  return Math.max(0, cursor) + Math.max(0, chatsRecebidos);
}

export async function executarRodadaHistorico(input: {
  admin?: Admin;
  client?: WahaClient | null;
  habilitado?: boolean;
} = {}): Promise<ResultadoRodadaHistorico> {
  if (input.habilitado === false) {
    return { status: "desligado", chatsProcessados: 0, mensagensInseridas: 0, efeitosPorOrganizacao: {} };
  }
  const client = input.client === undefined ? getWahaClient() : input.client;
  if (!client) {
    return { status: "nao_configurado", chatsProcessados: 0, mensagensInseridas: 0, efeitosPorOrganizacao: {} };
  }
  const admin = input.admin ?? createAdminClient();
  const { data, error } = await admin
    .from("channel_sessions")
    .select("id, organization_id, waha_session_name, metadata")
    .eq("provider", "waha")
    .eq("status", "WORKING")
    .is("archived_at", null)
    .not("waha_session_name", "is", null)
    .limit(50);
  if (error) throw new Error(`historico_sessions:${error.message}`);

  let chatsProcessados = 0;
  let mensagensInseridas = 0;
  const efeitosPorOrganizacao: Record<string, number> = {};
  const desde = new Date(Date.now() - JANELA_RECENTE_MS);
  for (const raw of data ?? []) {
    if (chatsProcessados >= LIMITE_DE_CHATS_POR_RODADA) break;
    const sessao: SessaoHistorico = {
      id: raw.id,
      organization_id: raw.organization_id,
      waha_session_name: raw.waha_session_name!,
      metadata: objeto(raw.metadata),
    };
    if (sessao.metadata.historico_importado_em) continue;
    const cursor = Number.isInteger(sessao.metadata.historico_cursor)
      ? Number(sessao.metadata.historico_cursor)
      : 0;
    const restante = LIMITE_DE_CHATS_POR_RODADA - chatsProcessados;
    const chats = await client.listChats(sessao.waha_session_name, { limit: restante, offset: cursor });
    if (chats.status === "store_desligado") {
      await admin.from("channel_sessions").update({
        metadata: { ...sessao.metadata, historico_store_desligado_em: new Date().toISOString() },
      }).eq("id", sessao.id).eq("organization_id", sessao.organization_id);
      continue;
    }
    for (const chat of chats.data) {
      chatsProcessados++;
      try {
        let contato = await contatoDoChat(admin, sessao.organization_id, chat.id);
        let mensagens: WahaHistoryResult<WahaPayload[]> | null = null;
        if (!contato && parseChatId(chat.id).kind === "lid") {
          mensagens = await mensagensDoChat(client, sessao, chat.id, 0);
          if (mensagens.status === "ok") {
            const telefone = mensagens.data.map(telefoneAlternativoDe).find(Boolean);
            if (telefone) {
              contato = await encontrarContatoPorTelefone(
                admin as unknown as SupabaseClient,
                sessao.organization_id,
                telefone,
              );
            }
          }
        }
        if (!contato) continue;
        mensagens ??= await mensagensDoChat(client, sessao, chat.id, 0);
        if (mensagens.status === "store_desligado") continue;
        const offsetAprofundamento = mensagens.data.filter((p) => {
          const instante = instanteDaMensagem(p);
          return instante !== null && new Date(instante) >= desde;
        }).length;
        const resultado = await importarPayloadsSilenciosamente({
          admin,
          sessao,
          contato,
          payloads: mensagens.data,
          desde,
          registrarOffset: offsetAprofundamento,
        });
        mensagensInseridas += resultado.inseridas;
        efeitosPorOrganizacao[sessao.organization_id] =
          (efeitosPorOrganizacao[sessao.organization_id] ?? 0) + resultado.inseridas;
      } catch (err) {
        logger.warn("historico.canal: chat ignorado apos falha", {
          organization_id: sessao.organization_id,
          channel_session_id: sessao.id,
          chat_kind: parseChatId(chat.id).kind,
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }
    const terminou = chats.data.length < restante;
    await admin.from("channel_sessions").update({
      metadata: {
        ...sessao.metadata,
        historico_cursor: proximoCursorHistorico(cursor, chats.data.length),
        ...(terminou ? { historico_importado_em: new Date().toISOString() } : {}),
      },
    }).eq("id", sessao.id).eq("organization_id", sessao.organization_id);
  }
  return { status: "ok", chatsProcessados, mensagensInseridas, efeitosPorOrganizacao };
}

export async function aprofundarHistorico(input: {
  organizationId: string;
  conversationId: string;
  admin?: Admin;
  client?: WahaClient | null;
}): Promise<ResultadoImportacao | { status: "ja_importado" | "indisponivel"; inseridas: 0 }> {
  const admin = input.admin ?? createAdminClient();
  const { data: conversa, error } = await admin
    .from("conversations")
    .select("id, contact_id, channel_session_id, metadata, contacts(phone_number, wa_identity, wa_lid), channel_sessions(waha_session_name, provider, status, metadata)")
    .eq("organization_id", input.organizationId)
    .eq("id", input.conversationId)
    .maybeSingle();
  if (error || !conversa) return { status: "indisponivel", inseridas: 0 };
  const metadata = objeto(conversa.metadata);
  if (metadata.historico_profundo_em) return { status: "ja_importado", inseridas: 0 };
  const contato = conversa.contacts as unknown as ContatoHistorico | null;
  const canal = conversa.channel_sessions as unknown as {
    waha_session_name: string | null;
    provider: string;
    status: string;
    metadata: unknown;
  } | null;
  if (!contato || !canal || canal.provider !== "waha" || canal.status !== "WORKING" || !canal.waha_session_name) {
    return { status: "indisponivel", inseridas: 0 };
  }
  const chatId = resolveWahaChatId({
    isGroup: false,
    groupChatId: null,
    phoneNumber: contato.phone_number,
    waIdentity: contato.wa_identity,
    waLid: contato.wa_lid,
  });
  if (!chatId) return { status: "indisponivel", inseridas: 0 };
  const client = input.client === undefined ? getWahaClient() : input.client;
  if (!client) return { status: "nao_configurado", inseridas: 0, duplicadas: 0, ignoradas: 0 };
  const offset = Number.isInteger(metadata.historico_offset) ? Number(metadata.historico_offset) : 0;
  const payloads = await client.getChatMessages(canal.waha_session_name, chatId, {
    limit: LIMITE_POR_CHAT,
    offset,
    downloadMedia: false,
  });
  if (payloads.status === "store_desligado") {
    return { status: "store_desligado", inseridas: 0, duplicadas: 0, ignoradas: 0 };
  }
  const sessao: SessaoHistorico = {
    id: conversa.channel_session_id,
    organization_id: input.organizationId,
    waha_session_name: canal.waha_session_name,
    metadata: objeto(canal.metadata),
  };
  const resultado = await importarPayloadsSilenciosamente({ admin, sessao, contato, payloads: payloads.data });
  await admin.from("conversations").update({
    metadata: {
      ...metadata,
      historico_offset: offset + payloads.data.length,
      historico_profundo_em: new Date().toISOString(),
    },
  }).eq("id", input.conversationId).eq("organization_id", input.organizationId);
  return resultado;
}
