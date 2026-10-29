-- 0293: fila persistente e opt-in para a primeira mensagem de automação.
--
-- O item nasce do evento message.received e é consumido por outro evento do
-- event_log. Assim a regra original só avança para a próxima ação depois de o
-- envio terminar ou ser descartado com motivo. O claim usa advisory lock por
-- organização + canal, portanto dois drains não furam FIFO nem o intervalo.

alter table public.channel_knobs
  add column if not exists first_message_queue_min_interval_seconds integer not null default 120,
  add column if not exists first_message_queue_max_interval_seconds integer not null default 240,
  add column if not exists first_message_queue_daily_limit integer not null default 200,
  add column if not exists first_message_queue_paused boolean not null default false,
  add column if not exists first_message_queue_next_at timestamptz;

update public.channel_knobs
set first_message_queue_min_interval_seconds = greatest(
      1,
      coalesce(first_message_queue_min_interval_seconds, 120)
    ),
    first_message_queue_max_interval_seconds = greatest(
      greatest(1, coalesce(first_message_queue_min_interval_seconds, 120)),
      coalesce(first_message_queue_max_interval_seconds, 240)
    ),
    first_message_queue_daily_limit = greatest(
      1,
      coalesce(first_message_queue_daily_limit, 200)
    ),
    first_message_queue_paused = coalesce(first_message_queue_paused, false);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'channel_knobs_first_message_queue_interval_check'
      and conrelid = 'public.channel_knobs'::regclass
  ) then
    alter table public.channel_knobs
      add constraint channel_knobs_first_message_queue_interval_check
      check (
        first_message_queue_min_interval_seconds between 1 and 86400
        and first_message_queue_max_interval_seconds between first_message_queue_min_interval_seconds and 86400
      );
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'channel_knobs_first_message_queue_daily_limit_check'
      and conrelid = 'public.channel_knobs'::regclass
  ) then
    alter table public.channel_knobs
      add constraint channel_knobs_first_message_queue_daily_limit_check
      check (first_message_queue_daily_limit between 1 and 10000);
  end if;
end $$;

create table if not exists public.automation_first_message_queue (
  id uuid primary key default gen_random_uuid(),
  queue_sequence bigint generated always as identity,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  channel_session_id uuid not null references public.channel_sessions(id) on delete cascade,
  original_event_id uuid not null references public.event_log(id) on delete cascade,
  queue_event_id uuid references public.event_log(id) on delete set null,
  rule_id uuid not null references public.automation_rules(id) on delete cascade,
  action_index integer not null,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  action_config jsonb not null default '{}'::jsonb,
  status text not null default 'queued',
  discard_reason text,
  outbound_message_id uuid references public.messages(id) on delete set null,
  result jsonb,
  next_attempt_at timestamptz,
  enqueued_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automation_first_message_queue_action_index_check check (action_index >= 0),
  constraint automation_first_message_queue_status_check
    check (status in ('queued', 'processing', 'sent', 'discarded', 'failed')),
  constraint automation_first_message_queue_origin_unique
    unique (organization_id, original_event_id, rule_id, action_index)
);

-- Auto-cura uma tabela interrompida antes de o bloco acima terminar.
alter table public.automation_first_message_queue
  add column if not exists queue_sequence bigint generated always as identity,
  add column if not exists queue_event_id uuid references public.event_log(id) on delete set null,
  add column if not exists discard_reason text,
  add column if not exists outbound_message_id uuid references public.messages(id) on delete set null,
  add column if not exists result jsonb,
  add column if not exists next_attempt_at timestamptz,
  add column if not exists started_at timestamptz,
  add column if not exists finished_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists idx_automation_first_message_queue_origin
  on public.automation_first_message_queue
    (organization_id, original_event_id, rule_id, action_index);
create index if not exists idx_automation_first_message_queue_fifo
  on public.automation_first_message_queue
    (organization_id, channel_session_id, status, enqueued_at, queue_sequence);
create index if not exists idx_automation_first_message_queue_daily
  on public.automation_first_message_queue
    (organization_id, channel_session_id, started_at)
  where started_at is not null;

alter table public.automation_first_message_queue enable row level security;

drop policy if exists "automation_first_message_queue_select" on public.automation_first_message_queue;
create policy "automation_first_message_queue_select"
  on public.automation_first_message_queue
  for select
  using (
    organization_id in (select public.fn_user_org_ids())
    or public.fn_is_platform_admin()
  );

-- Os privilégios padrão do schema dão ALL a authenticated em tabela nova: sem
-- revogar aqui, o RLS (sem policy de escrita) até barraria as linhas, mas a
-- permissão de escrever continuaria concedida. A fila só se escreve pelo servidor.
revoke all on table public.automation_first_message_queue from anon, authenticated;
grant select on table public.automation_first_message_queue to authenticated;
grant all on table public.automation_first_message_queue to service_role;

-- A coluna identity cria uma sequência própria, que também herda ALL nos
-- privilégios padrão (inclusive para anon). Só o servidor precisa dela.
do $$
declare
  v_seq text := pg_get_serial_sequence('public.automation_first_message_queue', 'queue_sequence');
begin
  if v_seq is not null then
    execute format('revoke all on sequence %s from anon, authenticated', v_seq);
  end if;
end $$;

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
begin
  if p_action_index < 0
     or coalesce(p_action_config->>'fila', '') <> 'primeira_mensagem' then
    raise exception 'first_message_queue_invalid_action';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      p_organization_id::text || ':' || p_original_event_id::text || ':' ||
      p_rule_id::text || ':' || p_action_index::text,
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

  insert into public.automation_first_message_queue (
    organization_id,
    channel_session_id,
    original_event_id,
    rule_id,
    action_index,
    contact_id,
    conversation_id,
    action_config,
    enqueued_at,
    next_attempt_at
  ) values (
    p_organization_id,
    p_channel_session_id,
    p_original_event_id,
    p_rule_id,
    p_action_index,
    p_contact_id,
    p_conversation_id,
    p_action_config,
    coalesce(p_enqueued_at, now()),
    now()
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

create or replace function public.fn_try_claim_automation_first_message(
  p_organization_id uuid,
  p_queue_id uuid,
  p_now timestamptz default now(),
  p_claim boolean default false
)
returns table (
  decision text,
  retry_at timestamptz,
  next_day_start timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item public.automation_first_message_queue%rowtype;
  v_head_id uuid;
  v_processing record;
  v_paused boolean;
  v_min integer;
  v_max integer;
  v_limit integer;
  v_next timestamptz;
  v_timezone text;
  v_day_start timestamptz;
  v_next_day_start timestamptz;
  v_started_today integer;
  v_gap integer;
begin
  select q.* into v_item
  from public.automation_first_message_queue q
  where q.id = p_queue_id
    and q.organization_id = p_organization_id;

  if not found then
    return query select 'terminal'::text, null::timestamptz, null::timestamptz;
    return;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_organization_id::text || ':' || v_item.channel_session_id::text, 0)
  );

  select q.* into v_item
  from public.automation_first_message_queue q
  where q.id = p_queue_id
    and q.organization_id = p_organization_id
  for update;

  if v_item.status in ('sent', 'discarded', 'failed') then
    return query select 'terminal'::text, null::timestamptz, null::timestamptz;
    return;
  end if;

  if v_item.status = 'processing' then
    if v_item.started_at <= p_now - interval '10 minutes' then
      update public.automation_first_message_queue
      set status = 'failed',
          discard_reason = 'processing_timeout',
          finished_at = p_now,
          updated_at = p_now
      where id = p_queue_id
        and organization_id = p_organization_id;
      return query select 'stale'::text, null::timestamptz, null::timestamptz;
    end if;
    return query
      select 'processing'::text,
             v_item.started_at + interval '10 minutes',
             null::timestamptz;
    return;
  end if;

  insert into public.channel_knobs (organization_id, channel_session_id)
  values (p_organization_id, v_item.channel_session_id)
  on conflict (organization_id, channel_session_id) do nothing;

  select
    k.first_message_queue_paused,
    k.first_message_queue_min_interval_seconds,
    k.first_message_queue_max_interval_seconds,
    k.first_message_queue_daily_limit,
    k.first_message_queue_next_at,
    coalesce(k.timezone, 'America/Sao_Paulo')
  into v_paused, v_min, v_max, v_limit, v_next, v_timezone
  from public.channel_knobs k
  where k.organization_id = p_organization_id
    and k.channel_session_id = v_item.channel_session_id
  for update;

  if v_paused then
    return query
      select 'paused'::text, p_now + interval '1 minute', null::timestamptz;
    return;
  end if;

  select q.id, q.started_at into v_processing
  from public.automation_first_message_queue q
  where q.organization_id = p_organization_id
    and q.channel_session_id = v_item.channel_session_id
    and q.status = 'processing'
    and q.id <> p_queue_id
  order by q.started_at asc
  limit 1;
  if found then
    return query
      select 'processing'::text,
             greatest(v_processing.started_at + interval '10 minutes', p_now + interval '30 seconds'),
             null::timestamptz;
    return;
  end if;

  select q.id into v_head_id
  from public.automation_first_message_queue q
  where q.organization_id = p_organization_id
    and q.channel_session_id = v_item.channel_session_id
    and q.status = 'queued'
  order by q.enqueued_at asc, q.queue_sequence asc
  limit 1;

  if v_head_id is distinct from p_queue_id then
    return query
      select 'not_head'::text,
             greatest(coalesce(v_next, p_now), p_now + interval '30 seconds'),
             null::timestamptz;
    return;
  end if;

  if v_next is not null and v_next > p_now then
    return query select 'interval'::text, v_next, null::timestamptz;
    return;
  end if;

  v_day_start := (
    ((p_now at time zone v_timezone)::date)::timestamp at time zone v_timezone
  );
  v_next_day_start := (
    (((p_now at time zone v_timezone)::date + 1)::timestamp) at time zone v_timezone
  );

  select count(*)::integer into v_started_today
  from public.automation_first_message_queue q
  where q.organization_id = p_organization_id
    and q.channel_session_id = v_item.channel_session_id
    and q.started_at >= v_day_start
    and q.started_at < v_next_day_start;

  if v_started_today >= v_limit then
    return query
      select 'daily_limit'::text, null::timestamptz, v_next_day_start;
    return;
  end if;

  if not p_claim then
    return query select 'ready'::text, null::timestamptz, null::timestamptz;
    return;
  end if;

  update public.automation_first_message_queue
  set status = 'processing',
      started_at = p_now,
      next_attempt_at = null,
      updated_at = p_now
  where id = p_queue_id
    and organization_id = p_organization_id
    and status = 'queued';
  if not found then
    return query
      select 'not_head'::text, p_now + interval '30 seconds', null::timestamptz;
    return;
  end if;

  v_gap := v_min + floor(random() * (v_max - v_min + 1))::integer;
  update public.channel_knobs
  set first_message_queue_next_at = p_now + make_interval(secs => v_gap),
      updated_at = p_now
  where organization_id = p_organization_id
    and channel_session_id = v_item.channel_session_id;

  return query select 'claimed'::text, null::timestamptz, null::timestamptz;
end;
$$;

revoke execute on function public.fn_try_claim_automation_first_message(
  uuid, uuid, timestamptz, boolean
) from public, anon, authenticated;
grant execute on function public.fn_try_claim_automation_first_message(
  uuid, uuid, timestamptz, boolean
) to service_role;

comment on table public.automation_first_message_queue is
  'Fila opt-in por ação para a primeira mensagem automática, serializada por canal.';
comment on column public.channel_knobs.first_message_queue_paused is
  'Pausa persistente da fila de primeira mensagem deste canal.';
