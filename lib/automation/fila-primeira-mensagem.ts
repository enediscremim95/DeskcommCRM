import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  ActionCtx,
  ActionResultDetail,
} from "@/lib/automation/types";

export const MARCADOR_FILA_PRIMEIRA_MENSAGEM = "primeira_mensagem";
export const EVENTO_FILA_PRIMEIRA_MENSAGEM =
  "automation.first_message_queued";
export const CONSUMIDOR_FILA_PRIMEIRA_MENSAGEM =
  "automation-first-message-queue";

export const FILA_PRIMEIRA_MENSAGEM_DEFAULTS = {
  minIntervalSeconds: 120,
  maxIntervalSeconds: 240,
  dailyLimit: 200,
  paused: false,
} as const;

export type StatusFilaPrimeiraMensagem =
  | "queued"
  | "processing"
  | "sent"
  | "discarded"
  | "failed";

export interface ItemFilaPrimeiraMensagem {
  id: string;
  organization_id: string;
  channel_session_id: string;
  original_event_id: string;
  queue_event_id: string | null;
  rule_id: string;
  action_index: number;
  contact_id: string;
  conversation_id: string;
  action_config: Record<string, unknown>;
  status: StatusFilaPrimeiraMensagem;
  discard_reason: string | null;
  outbound_message_id: string | null;
  next_attempt_at: string | null;
  enqueued_at: string;
  started_at: string | null;
  finished_at: string | null;
}

interface EnqueueResult {
  queue_id: string;
  status: StatusFilaPrimeiraMensagem;
  next_attempt_at: string | null;
  discard_reason: string | null;
  outbound_message_id: string | null;
}

function primeiraLinha<T>(data: unknown): T | null {
  if (Array.isArray(data)) return (data[0] as T | undefined) ?? null;
  if (data && typeof data === "object") return data as T;
  return null;
}

export function acaoUsaFilaPrimeiraMensagem(
  config: Record<string, unknown>,
): boolean {
  return config.fila === MARCADOR_FILA_PRIMEIRA_MENSAGEM;
}

function contextoDaFila(ctx: ActionCtx): {
  contactId: string;
  conversationId: string;
  channelSessionId: string;
  actionIndex: number;
} {
  const contact = ctx.context.contact as { id?: unknown } | undefined;
  const contactId = typeof contact?.id === "string" ? contact.id : null;
  const conversationId =
    typeof ctx.event.payload?.conversation_id === "string"
      ? ctx.event.payload.conversation_id
      : null;
  const channelSessionId =
    typeof ctx.event.payload?.channel_session_id === "string"
      ? ctx.event.payload.channel_session_id
      : null;
  const actionIndex = ctx.actionIndex;

  if (
    !contactId ||
    !conversationId ||
    !channelSessionId ||
    !Number.isInteger(actionIndex) ||
    Number(actionIndex) < 0
  ) {
    throw new Error("first_message_queue_context_invalid");
  }
  return {
    contactId,
    conversationId,
    channelSessionId,
    actionIndex: Number(actionIndex),
  };
}

export async function garantirItemFilaPrimeiraMensagem(
  ctx: ActionCtx,
  config: Record<string, unknown>,
): Promise<EnqueueResult> {
  const fila = contextoDaFila(ctx);
  const configuredChannel =
    typeof config.channel_session_id === "string"
      ? config.channel_session_id
      : null;
  if (!configuredChannel || configuredChannel !== fila.channelSessionId) {
    throw new Error("first_message_queue_channel_mismatch");
  }

  const { data, error } = await ctx.admin.rpc(
    "fn_enqueue_automation_first_message",
    {
      p_organization_id: ctx.organizationId,
      p_channel_session_id: fila.channelSessionId,
      p_original_event_id: ctx.event.id,
      p_rule_id: ctx.ruleId,
      p_action_index: fila.actionIndex,
      p_contact_id: fila.contactId,
      p_conversation_id: fila.conversationId,
      p_action_config: config,
      p_enqueued_at: ctx.event.created_at ?? new Date().toISOString(),
    },
  );
  if (error) {
    throw new Error(`first_message_queue_enqueue_failed: ${error.message}`);
  }
  const row = primeiraLinha<EnqueueResult>(data);
  if (!row?.queue_id) throw new Error("first_message_queue_enqueue_empty");
  return row;
}

export async function lerItemFilaDaAcao(
  admin: SupabaseClient,
  ctx: ActionCtx,
): Promise<ItemFilaPrimeiraMensagem | null> {
  const actionIndex = ctx.actionIndex;
  if (!Number.isInteger(actionIndex)) return null;
  const { data, error } = await admin
    .from("automation_first_message_queue")
    .select("*")
    .eq("organization_id", ctx.organizationId)
    .eq("original_event_id", ctx.event.id)
    .eq("rule_id", ctx.ruleId)
    .eq("action_index", Number(actionIndex))
    .maybeSingle();
  if (error) {
    throw new Error(`first_message_queue_read_failed: ${error.message}`);
  }
  return (data as ItemFilaPrimeiraMensagem | null) ?? null;
}

export function esperaDaFila(
  row: EnqueueResult,
  now: Date = new Date(),
): string | null {
  if (["sent", "discarded", "failed"].includes(row.status)) return null;
  return row.next_attempt_at ?? new Date(now.getTime() + 60_000).toISOString();
}

export function resultadoDaFila(
  item: ItemFilaPrimeiraMensagem | null,
): ActionResultDetail {
  if (!item) {
    return {
      type: "send_whatsapp_message",
      status: "failed",
      error: "first_message_queue_item_missing",
    };
  }
  const detail = {
    queue_id: item.id,
    ...(item.outbound_message_id
      ? { message_id: item.outbound_message_id }
      : {}),
  };
  if (item.status === "sent") {
    return { type: "send_whatsapp_message", status: "success", detail };
  }
  if (item.status === "discarded") {
    return {
      type: "send_whatsapp_message",
      status: "skipped",
      detail: {
        ...detail,
        reason: item.discard_reason ?? "first_message_queue_discarded",
      },
    };
  }
  if (item.status === "failed") {
    return {
      type: "send_whatsapp_message",
      status: "failed",
      error: item.discard_reason ?? "first_message_queue_failed",
      detail,
    };
  }
  return {
    type: "send_whatsapp_message",
    status: "postponed",
    detail: {
      ...detail,
      reason: "fila_primeira_mensagem",
      retry_at: item.next_attempt_at,
    },
  };
}

export function semMarcadorDaFila(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const { fila: _fila, ...restante } = config;
  return restante;
}
