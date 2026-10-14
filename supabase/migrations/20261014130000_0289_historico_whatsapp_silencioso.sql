-- Histórico importado é contexto, não uma nova entrada operacional.
-- O marcador jsonb permite que a mesma tabela preserve o fio sem disparar
-- consumidores de mensagens ao vivo.

create or replace function public.fn_reply_inbound_revision() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.direction = 'inbound'
     and coalesce(new.metadata->>'historico', 'false') <> 'true' then
    update public.conversations
       set reply_context_revision = reply_context_revision + 1
     where organization_id = new.organization_id
       and id = new.conversation_id
       and contact_id = new.contact_id;
  end if;
  return new;
end;
$$;

revoke all on function public.fn_reply_inbound_revision() from public, anon, authenticated;

drop trigger if exists trg_messages_emit_event on public.messages;
create trigger trg_messages_emit_event
  after insert on public.messages
  for each row
  when (coalesce(new.metadata->>'historico', 'false') <> 'true')
  execute function public.fn_emit_message_event();

drop trigger if exists trg_demanda_abre_no_inbound on public.messages;
create trigger trg_demanda_abre_no_inbound
  after insert on public.messages
  for each row
  when (coalesce(new.metadata->>'historico', 'false') <> 'true')
  execute function public.fn_demanda_abre_no_inbound();

drop trigger if exists trg_conversation_routing_requested on public.conversations;
create trigger trg_conversation_routing_requested
  after insert on public.conversations
  for each row
  when (
    new.assigned_to_user_id is null
    and new.status in ('open', 'pending')
    and coalesce(new.metadata->>'historico', 'false') <> 'true'
  )
  execute function public.fn_emit_conversation_routing();

-- Atualiza a projeção da lista sem mexer no unread, no atendimento ou em leads.
-- greatest() torna a operação monotônica mesmo se uma mensagem ao vivo chegar
-- entre a leitura do histórico e este carimbo.
create or replace function public.fn_mark_historical_conversation_message(
  p_org uuid,
  p_conv uuid,
  p_direction text,
  p_preview text,
  p_at timestamptz
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contact uuid;
begin
  update public.conversations
     set last_message_at = greatest(coalesce(last_message_at, p_at), p_at),
         last_message_preview = case
           when last_message_at is null or p_at >= last_message_at then p_preview
           else last_message_preview
         end,
         last_inbound_at = case
           when p_direction = 'inbound' then greatest(coalesce(last_inbound_at, p_at), p_at)
           else last_inbound_at
         end,
         last_outbound_at = case
           when p_direction = 'outbound' then greatest(coalesce(last_outbound_at, p_at), p_at)
           else last_outbound_at
         end
   where id = p_conv
     and organization_id = p_org
  returning contact_id into v_contact;

  if v_contact is not null then
    update public.contacts
       set last_activity_at = greatest(coalesce(last_activity_at, p_at), p_at)
     where id = v_contact
       and organization_id = p_org;
  end if;
end;
$$;

revoke execute on function public.fn_mark_historical_conversation_message(uuid, uuid, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.fn_mark_historical_conversation_message(uuid, uuid, text, text, timestamptz)
  to service_role;
