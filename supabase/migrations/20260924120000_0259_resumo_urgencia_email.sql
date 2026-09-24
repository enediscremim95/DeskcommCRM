-- Ações urgentes usam o mesmo outbox dos leads novos, com janela longa,
-- deduplicação por situação e teto diário por destinatário.

alter table public.notification_email_batches
  drop constraint if exists notification_email_batches_kind_check;
alter table public.notification_email_batches
  add constraint notification_email_batches_kind_check
  check (kind in ('new_lead', 'urgent_lead'));

alter table public.notification_email_batches
  drop constraint if exists notification_email_batches_status_check;
alter table public.notification_email_batches
  add constraint notification_email_batches_status_check
  check (status in ('pending', 'processing', 'sent', 'suppressed'));

alter table public.notification_email_batches
  add column if not exists deferred_count integer not null default 0
  check (deferred_count >= 0);

alter table public.notification_email_batch_items
  add column if not exists kind text;
alter table public.notification_email_batch_items
  add column if not exists urgency_reason text;
alter table public.notification_email_batch_items
  add column if not exists stage_name text;
alter table public.notification_email_batch_items
  add column if not exists action_required_at timestamptz;
alter table public.notification_email_batch_items
  add column if not exists deferred_by_daily_limit boolean not null default false;

update public.notification_email_batch_items i
   set kind = b.kind
  from public.notification_email_batches b
 where b.id = i.batch_id
   and b.organization_id = i.organization_id
   and i.kind is null;
update public.notification_email_batch_items
   set kind = 'new_lead'
 where kind is null;
alter table public.notification_email_batch_items
  alter column kind set default 'new_lead';
alter table public.notification_email_batch_items
  alter column kind set not null;
alter table public.notification_email_batch_items
  drop constraint if exists notification_email_batch_items_kind_check;
alter table public.notification_email_batch_items
  add constraint notification_email_batch_items_kind_check
  check (kind in ('new_lead', 'urgent_lead'));

create index if not exists notification_email_batch_items_urgent_dedupe_idx
  on public.notification_email_batch_items
    (organization_id, recipient_user_id, lead_id, urgency_reason, created_at desc)
  where kind = 'urgent_lead';

create or replace function public.fn_queue_lead_email_batch(
  p_event_id uuid,
  p_recipient_user_id uuid,
  p_window_seconds integer default 30
)
returns table(batch_id uuid, due_at timestamptz, item_inserted boolean)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_event public.event_log%rowtype;
  v_title text;
  v_stage_name text;
  v_kind text;
  v_reason text;
  v_batch_id uuid;
  v_due_at timestamptz;
  v_existing_batch_id uuid;
  v_window_seconds integer;
  v_daily_limit integer;
  v_sent_today integer;
  v_deferred boolean := false;
  v_window_setting text;
  v_limit_setting text;
begin
  select * into v_event
    from public.event_log
   where id = p_event_id
     and event_type in ('lead.created', 'lead.action_required');
  if not found or v_event.entity_id is null then
    raise exception 'fn_queue_lead_email_batch: evento de lead inválido';
  end if;

  v_kind := case when v_event.event_type = 'lead.created'
    then 'new_lead' else 'urgent_lead' end;
  v_reason := case when v_kind = 'urgent_lead'
    then coalesce(nullif(v_event.payload->>'reason', ''), 'risk') else null end;

  if v_kind = 'new_lead' then
    if p_window_seconds < 5 or p_window_seconds > 300 then
      raise exception 'fn_queue_lead_email_batch: janela de lead novo fora do intervalo permitido';
    end if;
    v_window_seconds := p_window_seconds;
    v_daily_limit := 24;
  else
    select
      settings #>> '{notifications,email,urgent_batch_window_minutes}',
      settings #>> '{notifications,email,urgent_daily_limit}'
      into v_window_setting, v_limit_setting
      from public.organizations
     where id = v_event.organization_id;
    v_window_seconds := case
      when v_window_setting ~ '^\d+$'
        then greatest(300, least(86400, v_window_setting::integer * 60))
      else 3600
    end;
    v_daily_limit := case
      when v_limit_setting ~ '^\d+$'
        then greatest(1, least(24, v_limit_setting::integer))
      else 6
    end;
  end if;

  if not exists (
    select 1
      from public.user_organizations uo
     where uo.organization_id = v_event.organization_id
       and uo.user_id = p_recipient_user_id
       and uo.revoked_at is null
  ) then
    raise exception 'fn_queue_lead_email_batch: destinatário fora da organização';
  end if;

  select i.batch_id into v_existing_batch_id
    from public.notification_email_batch_items i
   where i.event_id = p_event_id
     and i.recipient_user_id = p_recipient_user_id;
  if found then
    return query
      select b.id, b.due_at, false
        from public.notification_email_batches b
       where b.id = v_existing_batch_id;
    return;
  end if;

  if v_kind = 'urgent_lead' then
    perform pg_advisory_xact_lock(hashtextextended(
      p_recipient_user_id::text || ':' || v_event.entity_id::text || ':' || v_reason,
      0
    ));
    select i.batch_id into v_existing_batch_id
      from public.notification_email_batch_items i
     where i.organization_id = v_event.organization_id
       and i.recipient_user_id = p_recipient_user_id
       and i.lead_id = v_event.entity_id
       and i.kind = 'urgent_lead'
       and i.urgency_reason = v_reason
       and i.created_at >= now() - interval '24 hours'
     order by i.created_at desc
     limit 1;
    if found then
      return query
        select b.id, b.due_at, false
          from public.notification_email_batches b
         where b.id = v_existing_batch_id;
      return;
    end if;
  end if;

  select l.title, s.name into v_title, v_stage_name
    from public.crm_leads l
    left join public.crm_stages s
      on s.id = l.stage_id and s.organization_id = l.organization_id
   where l.id = v_event.entity_id
     and l.organization_id = v_event.organization_id;
  if not found then
    raise exception 'fn_queue_lead_email_batch: lead fora da organização';
  end if;

  if v_kind = 'urgent_lead' then
    select count(*)::integer into v_sent_today
      from public.notification_email_batches b
     where b.organization_id = v_event.organization_id
       and b.recipient_user_id = p_recipient_user_id
       and b.kind = 'urgent_lead'
       and b.status in ('sent', 'suppressed')
       and b.sent_at >= date_trunc('day', now());
    v_deferred := v_sent_today >= v_daily_limit or exists (
      select 1
        from public.notification_email_batches b
       where b.organization_id = v_event.organization_id
         and b.recipient_user_id = p_recipient_user_id
         and b.kind = 'urgent_lead'
         and b.status = 'suppressed'
         and b.sent_at >= date_trunc('day', now())
    );
  end if;

  v_due_at := case when v_deferred
    then date_trunc('day', now()) + interval '1 day' + make_interval(secs => v_window_seconds)
    else now() + make_interval(secs => v_window_seconds)
  end;

  insert into public.notification_email_batches (
    organization_id, recipient_user_id, kind, status, due_at, deferred_count
  ) values (
    v_event.organization_id, p_recipient_user_id, v_kind, 'pending', v_due_at,
    case when v_deferred then 1 else 0 end
  )
  on conflict (organization_id, recipient_user_id, kind) where status = 'pending'
  do update set
    due_at = case
      when excluded.deferred_count > 0
        then greatest(notification_email_batches.due_at, excluded.due_at)
      when notification_email_batches.kind = 'urgent_lead'
        then notification_email_batches.due_at
      else excluded.due_at
    end,
    deferred_count = notification_email_batches.deferred_count + excluded.deferred_count,
    updated_at = now()
  returning id, notification_email_batches.due_at into v_batch_id, v_due_at;

  insert into public.notification_email_batch_items (
    organization_id, batch_id, event_id, recipient_user_id, lead_id, lead_title,
    kind, urgency_reason, stage_name, action_required_at, deferred_by_daily_limit
  ) values (
    v_event.organization_id, v_batch_id, p_event_id, p_recipient_user_id,
    v_event.entity_id, coalesce(nullif(trim(v_title), ''), 'Lead sem nome'),
    v_kind, v_reason, v_stage_name,
    case when v_kind = 'urgent_lead' then v_event.created_at else null end,
    v_deferred
  )
  on conflict (event_id, recipient_user_id) do nothing;

  if not found then
    select i.batch_id into v_existing_batch_id
      from public.notification_email_batch_items i
     where i.event_id = p_event_id
       and i.recipient_user_id = p_recipient_user_id;
    return query
      select b.id, b.due_at, false
        from public.notification_email_batches b
       where b.id = v_existing_batch_id;
    return;
  end if;

  insert into public.event_log (
    organization_id, event_type, entity_kind, entity_id, payload, metadata, next_attempt_at
  ) values (
    v_event.organization_id, 'notification.email_batch_due',
    'notification_email_batch', v_batch_id,
    jsonb_build_object('kind', v_kind),
    jsonb_build_object('source_event_id', p_event_id), v_due_at
  )
  on conflict (organization_id, entity_id) where event_type = 'notification.email_batch_due'
  do update set status = 'pending', next_attempt_at = excluded.next_attempt_at, updated_at = now();

  return query select v_batch_id, v_due_at, true;
end;
$$;

revoke execute on function public.fn_queue_lead_email_batch(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.fn_queue_lead_email_batch(uuid, uuid, integer)
  to service_role;

comment on table public.notification_email_batches is
  'Outbox de resumos de leads novos e urgentes, agrupada por organização e destinatário.';
comment on column public.notification_email_batches.deferred_count is
  'Quantidade de situações urgentes adiadas pelo teto diário para o resumo seguinte.';
