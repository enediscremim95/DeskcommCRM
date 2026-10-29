-- Impede duas primeiras mensagens para o mesmo contato no mesmo canal.
-- A mesma origem continua idempotente; origens concorrentes são serializadas
-- por contato antes da consulta da janela de 72 horas.

create or replace function public.fn_enqueue_automation_first_message(
  p_organization_id uuid,
  p_channel_session_id uuid,
  p_original_event_id uuid,
  p_rule_id uuid,
  p_action_index integer,
  p_contact_id uuid,
  p_conversation_id uuid,
  p_action_config jsonb,
  p_enqueued_at timestamptz
)
returns table (
  queue_id uuid,
  status text,
  next_attempt_at timestamptz,
  discard_reason text,
  outbound_message_id uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_queue_id uuid;
  v_queue_event_id uuid;
  v_enqueued_at timestamptz := coalesce(p_enqueued_at, now());
  v_duplicate_contact boolean := false;
begin
  if p_action_index < 0
     or coalesce(p_action_config->>'fila', '') <> 'primeira_mensagem' then
    raise exception 'first_message_queue_invalid_action';
  end if;

  -- Todos os chamadores tomam os locks na mesma ordem. O lock por contato
  -- fecha a janela entre duas origens; o lock por origem preserva a
  -- idempotência já existente.
  perform pg_advisory_xact_lock(
    hashtextextended(
      'automation-first-message-contact:' || p_organization_id::text || ':' ||
      p_channel_session_id::text || ':' || p_contact_id::text,
      0
    )
  );
  perform pg_advisory_xact_lock(
    hashtextextended(
      'automation-first-message-origin:' || p_organization_id::text || ':' ||
      p_original_event_id::text || ':' || p_rule_id::text || ':' ||
      p_action_index::text,
      0
    )
  );

  if not exists (
    select 1
    from public.channel_sessions s
    where s.id = p_channel_session_id
      and s.organization_id = p_organization_id
  ) or not exists (
    select 1
    from public.event_log e
    where e.id = p_original_event_id
      and e.organization_id = p_organization_id
      and e.event_type = 'message.received'
  ) or not exists (
    select 1
    from public.automation_rules r
    where r.id = p_rule_id
      and r.organization_id = p_organization_id
  ) or not exists (
    select 1
    from public.contacts c
    where c.id = p_contact_id
      and c.organization_id = p_organization_id
  ) or not exists (
    select 1
    from public.conversations c
    where c.id = p_conversation_id
      and c.organization_id = p_organization_id
      and c.contact_id = p_contact_id
      and c.channel_session_id = p_channel_session_id
  ) then
    raise exception 'first_message_queue_cross_tenant_or_stale_origin';
  end if;

  -- A mesma origem sempre devolve o item que já existia, inclusive se ele
  -- nasceu descartado. Ela não concorre de novo pela trava do contato.
  select q.id, q.queue_event_id
    into v_queue_id, v_queue_event_id
  from public.automation_first_message_queue q
  where q.organization_id = p_organization_id
    and q.original_event_id = p_original_event_id
    and q.rule_id = p_rule_id
    and q.action_index = p_action_index;

  if found then
    return query
    select q.id, q.status, q.next_attempt_at, q.discard_reason, q.outbound_message_id
    from public.automation_first_message_queue q
    where q.id = v_queue_id
      and q.organization_id = p_organization_id;
    return;
  end if;

  select exists (
    select 1
    from public.automation_first_message_queue q
    where q.organization_id = p_organization_id
      and q.channel_session_id = p_channel_session_id
      and q.contact_id = p_contact_id
      and q.status in ('queued', 'processing', 'sent')
      and q.enqueued_at > v_enqueued_at - interval '72 hours'
  ) into v_duplicate_contact;

  insert into public.automation_first_message_queue (
    organization_id,
    channel_session_id,
    original_event_id,
    rule_id,
    action_index,
    contact_id,
    conversation_id,
    action_config,
    status,
    discard_reason,
    next_attempt_at,
    enqueued_at,
    finished_at
  ) values (
    p_organization_id,
    p_channel_session_id,
    p_original_event_id,
    p_rule_id,
    p_action_index,
    p_contact_id,
    p_conversation_id,
    p_action_config,
    case when v_duplicate_contact then 'discarded' else 'queued' end,
    case when v_duplicate_contact then 'duplicado_do_contato' else null end,
    case when v_duplicate_contact then null else now() end,
    v_enqueued_at,
    case when v_duplicate_contact then now() else null end
  )
  on conflict (organization_id, original_event_id, rule_id, action_index)
  do nothing;

  select q.id, q.queue_event_id
    into v_queue_id, v_queue_event_id
  from public.automation_first_message_queue q
  where q.organization_id = p_organization_id
    and q.original_event_id = p_original_event_id
    and q.rule_id = p_rule_id
    and q.action_index = p_action_index;

  if v_duplicate_contact then
    return query
    select q.id, q.status, q.next_attempt_at, q.discard_reason, q.outbound_message_id
    from public.automation_first_message_queue q
    where q.id = v_queue_id
      and q.organization_id = p_organization_id;
    return;
  end if;

  if v_queue_event_id is null then
    v_queue_event_id := public.emit_event(
      'automation.first_message_queued',
      'automation_first_message_queue',
      v_queue_id,
      jsonb_build_object(
        'queue_id', v_queue_id,
        'channel_session_id', p_channel_session_id,
        'original_event_id', p_original_event_id
      ),
      jsonb_build_object('source', 'automation_rules'),
      p_organization_id
    );
    update public.automation_first_message_queue q
    set queue_event_id = v_queue_event_id,
        updated_at = now()
    where q.id = v_queue_id
      and q.organization_id = p_organization_id;
  end if;

  return query
  select q.id, q.status, q.next_attempt_at, q.discard_reason, q.outbound_message_id
  from public.automation_first_message_queue q
  where q.id = v_queue_id
    and q.organization_id = p_organization_id;
end;
$$;

revoke execute on function public.fn_enqueue_automation_first_message(
  uuid, uuid, uuid, uuid, integer, uuid, uuid, jsonb, timestamptz
) from public, anon, authenticated;
grant execute on function public.fn_enqueue_automation_first_message(
  uuid, uuid, uuid, uuid, integer, uuid, uuid, jsonb, timestamptz
) to service_role;
