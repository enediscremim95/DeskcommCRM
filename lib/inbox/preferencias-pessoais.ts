import type { SupabaseClient } from "@supabase/supabase-js";

import type { Conversation, Message } from "@/lib/types/messaging";

type DB = SupabaseClient;

export interface EstadoPessoalDaConversa {
  favorited_at: string | null;
  pinned_at: string | null;
  muted_until: string | null;
  marked_unread_at: string | null;
}

export interface EstadoPessoalDaMensagem {
  starred_at: string | null;
}

export async function lerEstadoPessoalDaMensagem(
  db: DB,
  organizationId: string,
  userId: string,
  messageId: string,
): Promise<EstadoPessoalDaMensagem> {
  const { data, error } = await db
    .from("inbox_user_message_state" as never)
    .select("starred_at")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("message_id", messageId)
    .maybeSingle();
  if (error) throw error;
  return data ? (data as unknown as EstadoPessoalDaMensagem) : { starred_at: null };
}

export const ESTADO_CONVERSA_VAZIO: EstadoPessoalDaConversa = {
  favorited_at: null,
  pinned_at: null,
  muted_until: null,
  marked_unread_at: null,
};

export function proximoEstadoPessoalDaConversa(
  atual: EstadoPessoalDaConversa,
  patch: { favorited?: boolean; pinned?: boolean },
  agora: string,
): EstadoPessoalDaConversa {
  return {
    ...atual,
    ...(patch.favorited === undefined
      ? {}
      : { favorited_at: patch.favorited ? atual.favorited_at ?? agora : null }),
    ...(patch.pinned === undefined
      ? {}
      : { pinned_at: patch.pinned ? atual.pinned_at ?? agora : null }),
  };
}

export async function lerEstadoPessoalDaConversa(
  db: DB,
  organizationId: string,
  userId: string,
  conversationId: string,
): Promise<EstadoPessoalDaConversa> {
  const { data, error } = await db
    .from("inbox_user_conversation_state" as never)
    .select("favorited_at,pinned_at,muted_until,marked_unread_at")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("conversation_id", conversationId)
    .maybeSingle();
  if (error) throw error;
  return data ? (data as unknown as EstadoPessoalDaConversa) : ESTADO_CONVERSA_VAZIO;
}

export async function salvarEstadoPessoalDaConversa(
  db: DB,
  organizationId: string,
  userId: string,
  conversationId: string,
  patch: { favorited?: boolean; pinned?: boolean },
): Promise<EstadoPessoalDaConversa> {
  const { data: conversa, error: conversaError } = await db
    .from("conversations")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("id", conversationId)
    .maybeSingle();
  if (conversaError) throw conversaError;
  if (!conversa) throw new Error("conversation_not_found");

  const atual = await lerEstadoPessoalDaConversa(db, organizationId, userId, conversationId);
  if (patch.pinned === true && !atual.pinned_at) {
    const { count, error } = await db
      .from("inbox_user_conversation_state" as never)
      .select("conversation_id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .not("pinned_at", "is", null);
    if (error) throw error;
    if ((count ?? 0) >= 5) throw new Error("inbox_pin_limit");
  }

  const agora = new Date().toISOString();
  const proximo = proximoEstadoPessoalDaConversa(atual, patch, agora);
  const { data, error } = await db
    .from("inbox_user_conversation_state" as never)
    .upsert(
      {
        organization_id: organizationId,
        user_id: userId,
        conversation_id: conversationId,
        ...proximo,
      } as never,
      { onConflict: "organization_id,user_id,conversation_id" },
    )
    .select("favorited_at,pinned_at,muted_until,marked_unread_at")
    .single();
  if (error) throw error;
  return data as unknown as EstadoPessoalDaConversa;
}

export async function salvarEstadoPessoalDaMensagem(
  db: DB,
  organizationId: string,
  userId: string,
  messageId: string,
  starred: boolean,
): Promise<EstadoPessoalDaMensagem> {
  const { data: mensagem, error: mensagemError } = await db
    .from("messages")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("id", messageId)
    .maybeSingle();
  if (mensagemError) throw mensagemError;
  if (!mensagem) throw new Error("message_not_found");

  const anterior = (await lerEstadoPessoalDaMensagem(db, organizationId, userId, messageId)).starred_at;
  const { data, error } = await db
    .from("inbox_user_message_state" as never)
    .upsert(
      {
        organization_id: organizationId,
        user_id: userId,
        message_id: messageId,
        starred_at: starred ? anterior ?? new Date().toISOString() : null,
      } as never,
      { onConflict: "organization_id,user_id,message_id" },
    )
    .select("starred_at")
    .single();
  if (error) throw error;
  return data as unknown as EstadoPessoalDaMensagem;
}

export async function enriquecerConversasComEstadoPessoal<T extends Conversation>(
  db: DB,
  organizationId: string,
  userId: string,
  conversas: T[],
): Promise<T[]> {
  if (conversas.length === 0) return conversas;
  const { data, error } = await db
    .from("inbox_user_conversation_state" as never)
    .select("conversation_id,favorited_at,pinned_at")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .in("conversation_id", conversas.map((item) => item.id));
  if (error) throw error;
  const porId = new Map(
    ((data ?? []) as unknown as Array<{ conversation_id: string; favorited_at: string | null; pinned_at: string | null }>).map(
      (item) => [item.conversation_id, item],
    ),
  );
  return conversas.map((item) => ({
    ...item,
    favorited_at: porId.get(item.id)?.favorited_at ?? null,
    pinned_at: porId.get(item.id)?.pinned_at ?? null,
  }));
}

export async function enriquecerMensagensComEstadoPessoal<T extends Message>(
  db: DB,
  organizationId: string,
  userId: string,
  mensagens: T[],
): Promise<T[]> {
  if (mensagens.length === 0) return mensagens;
  const { data, error } = await db
    .from("inbox_user_message_state" as never)
    .select("message_id,starred_at")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .in("message_id", mensagens.map((item) => item.id));
  if (error) throw error;
  const porId = new Map(
    ((data ?? []) as unknown as Array<{ message_id: string; starred_at: string | null }>).map(
      (item) => [item.message_id, item.starred_at],
    ),
  );
  return mensagens.map((item) => ({ ...item, starred_at: porId.get(item.id) ?? null }));
}
