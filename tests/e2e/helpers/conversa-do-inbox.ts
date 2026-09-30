import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import { credenciaisSupabaseDeTeste } from "../../../scripts/lib/env-de-teste";

const supabase = credenciaisSupabaseDeTeste();
const admin = createClient(supabase.url, supabase.serviceRole, {
  auth: { autoRefreshToken: false, persistSession: false },
});

export interface ConversaDoInbox {
  conversationId: string;
  contactName: string;
  limpar: () => Promise<void>;
}

/**
 * Cria a menor conversa real que abre o Inbox sem depender de fixtures de outra spec.
 *
 * A conversa fica esperando uma pessoa, portanto continua visível para um agent
 * em organizações com escopo own_and_unassigned.
 */
export async function semearConversaDoInbox(organizationId: string): Promise<ConversaDoInbox> {
  const sufixo = randomUUID();
  const contactName = `Conversa Inbox E2E ${sufixo.slice(0, 8)}`;

  const { data: sessao, error: erroSessao } = await admin
    .from("channel_sessions")
    .insert({
      organization_id: organizationId,
      waha_session_name: `inbox-e2e-${sufixo}`,
      display_name: "Número Inbox E2E",
      status: "WORKING",
      webhook_secret_encrypted: "\\x00",
    } as never)
    .select("id")
    .single();
  if (erroSessao || !sessao) {
    throw erroSessao ?? new Error("não foi possível criar o canal da conversa E2E");
  }
  const sessionId = (sessao as { id: string }).id;

  const { data: contato, error: erroContato } = await admin
    .from("contacts")
    .insert({ organization_id: organizationId, display_name: contactName } as never)
    .select("id")
    .single();
  if (erroContato || !contato) {
    await admin.from("channel_sessions").delete().eq("id", sessionId);
    throw erroContato ?? new Error("não foi possível criar o contato da conversa E2E");
  }
  const contactId = (contato as { id: string }).id;
  const agora = new Date().toISOString();

  const { data: conversa, error: erroConversa } = await admin
    .from("conversations")
    .insert({
      organization_id: organizationId,
      contact_id: contactId,
      channel_session_id: sessionId,
      status: "open",
      assigned_to_user_id: null,
      bot_silenced_until: "infinity",
      last_inbound_at: agora,
      last_message_at: agora,
      last_message_preview: "Conversa criada para abrir o Inbox no E2E.",
    } as never)
    .select("id")
    .single();
  if (erroConversa || !conversa) {
    await admin.from("contacts").delete().eq("id", contactId);
    await admin.from("channel_sessions").delete().eq("id", sessionId);
    throw erroConversa ?? new Error("não foi possível criar a conversa E2E");
  }
  const conversationId = (conversa as { id: string }).id;

  return {
    conversationId,
    contactName,
    limpar: async () => {
      const { error: erroAoLimparConversa } = await admin
        .from("conversations")
        .delete()
        .eq("id", conversationId);
      if (erroAoLimparConversa) throw erroAoLimparConversa;
      const { error: erroAoLimparContato } = await admin.from("contacts").delete().eq("id", contactId);
      if (erroAoLimparContato) throw erroAoLimparContato;
      const { error: erroAoLimparSessao } = await admin
        .from("channel_sessions")
        .delete()
        .eq("id", sessionId);
      if (erroAoLimparSessao) throw erroAoLimparSessao;
    },
  };
}
