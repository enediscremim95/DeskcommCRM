import type { SupabaseClient } from '@supabase/supabase-js';

import {
  CHANNEL_SESSION_REF_COLUMNS,
  DEFAULT_CHANNEL_PROVIDER,
  getAdapter,
  resolveSessionRef,
  type ChannelSessionRef,
} from '@/lib/channels';
import { logger } from '@/lib/logger';

interface ConversaParaEtiqueta {
  is_group: boolean;
  group_chat_id: string | null;
  contacts: {
    phone_number: string | null;
    wa_identity: string | null;
    wa_lid: string | null;
  } | null;
  channel_sessions: (ChannelSessionRef & { status: string }) | null;
}

export type AplicarEtiquetaResultado =
  | 'applied'
  | 'unsupported'
  | 'not_found'
  | 'label_not_found'
  | 'failed';

export async function aplicarEtiquetaNaConversa(
  supabase: SupabaseClient,
  input: { organizationId: string; conversationId: string; labelName: string },
): Promise<AplicarEtiquetaResultado> {
  try {
    const { data } = await supabase
      .from('conversations')
      .select(
        `is_group, group_chat_id, contacts:contact_id(phone_number, wa_identity, wa_lid), ` +
          `channel_sessions:channel_session_id(${CHANNEL_SESSION_REF_COLUMNS}, status)`,
      )
      .eq('id', input.conversationId)
      .eq('organization_id', input.organizationId)
      .maybeSingle();

    const conversa = data as unknown as ConversaParaEtiqueta | null;
    if (!conversa?.channel_sessions) return 'not_found';
    const sessao = conversa.channel_sessions;
    const adapter = getAdapter(sessao.provider ?? DEFAULT_CHANNEL_PROVIDER);
    if (!adapter.addChatLabel) return 'unsupported';

    const recipient = adapter.resolveRecipient({
      isGroup: conversa.is_group,
      groupChatId: conversa.group_chat_id,
      phoneNumber: conversa.contacts?.phone_number,
      waIdentity: conversa.contacts?.wa_identity,
      waLid: conversa.contacts?.wa_lid,
    });
    if (!recipient) return 'not_found';

    return await adapter.addChatLabel({
      organizationId: input.organizationId,
      sessionRef: resolveSessionRef(sessao),
      recipient,
      labelName: input.labelName,
    });
  } catch (err) {
    logger.warn('etiqueta externa não aplicada; atendimento preservado', {
      organization_id: input.organizationId,
      conversation_id: input.conversationId,
      error: err instanceof Error ? err.name : 'erro_desconhecido',
    });
    return 'failed';
  }
}
