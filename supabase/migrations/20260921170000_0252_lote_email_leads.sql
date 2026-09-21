-- Rajadas de lead novo viram um resumo durável por organização e destinatário.

create table if not exists public.notification_email_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'new_lead' check (kind in ('new_lead')),
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent')),
  due_at timestamptz not null,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);

create unique index if not exists notification_email_batches_pending_unique
  on public.notification_email_batches (organization_id, recipient_user_id, kind)
  where status = 'pending';
create index if not exists notification_email_batches_due_idx
  on public.notification_email_batches (due_at)
  where status = 'pending';

create table if not exists public.notification_email_batch_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  batch_id uuid not null,
  event_id uuid not null references public.event_log(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid not null references public.crm_leads(id) on delete cascade,
  lead_title text not null,
  created_at timestamptz not null default now(),
  constraint notification_email_batch_items_batch_fk
    foreign key (batch_id, organization_id)
    references public.notification_email_batches(id, organization_id)
    on delete cascade,
  unique (event_id, recipient_user_id)
);
create index if not exists notification_email_batch_items_batch_idx
  on public.notification_email_batch_items (organization_id, batch_id, created_at);

alter table public.notification_email_batches enable row level security;
alter table public.notification_email_batch_items enable row level security;
drop policy if exists notification_email_batches_select on public.notification_email_batches;
create policy notification_email_batches_select
  on public.notification_email_batches for select
  using (
    recipient_user_id = auth.uid()
    and organization_id in (select public.fn_user_org_ids())
  );
drop policy if exists notification_email_batch_items_select on public.notification_email_batch_items;
create policy notification_email_batch_items_select
  on public.notification_email_batch_items for select
  using (
    recipient_user_id = auth.uid()
    and organization_id in (select public.fn_user_org_ids())
  );
revoke all on table public.notification_email_batches from anon, authenticated;
revoke all on table public.notification_email_batch_items from anon, authenticated;
grant select on table public.notification_email_batches to authenticated;
grant select on table public.notification_email_batch_items to authenticated;
grant all on table public.notification_email_batches to service_role;
grant all on table public.notification_email_batch_items to service_role;
drop trigger if exists trg_notification_email_batches_updated_at
  on public.notification_email_batches;
create trigger trg_notification_email_batches_updated_at
  before update on public.notification_email_batches
  for each row execute function public.fn_set_updated_at();

create unique index if not exists event_log_email_batch_flush_unique
  on public.event_log (organization_id, entity_id)
  where event_type = 'notification.email_batch_due';

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
  v_batch_id uuid;
  v_due_at timestamptz;
  v_existing_batch_id uuid;
begin
  if p_window_seconds < 5 or p_window_seconds > 300 then
    raise exception 'fn_queue_lead_email_batch: janela fora do intervalo permitido';
  end if;

  select * into v_event
    from public.event_log
   where id = p_event_id
     and event_type = 'lead.created';
  if not found or v_event.entity_id is null then
    raise exception 'fn_queue_lead_email_batch: evento lead.created inválido';
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

  select l.title into v_title
    from public.crm_leads l
   where l.id = v_event.entity_id
     and l.organization_id = v_event.organization_id;
  if not found then
    raise exception 'fn_queue_lead_email_batch: lead fora da organização';
  end if;

  v_due_at := now() + make_interval(secs => p_window_seconds);
  insert into public.notification_email_batches (
    organization_id, recipient_user_id, kind, status, due_at
  ) values (
    v_event.organization_id, p_recipient_user_id, 'new_lead', 'pending', v_due_at
  )
  on conflict (organization_id, recipient_user_id, kind) where status = 'pending'
  do update set due_at = excluded.due_at, updated_at = now()
  returning id, notification_email_batches.due_at into v_batch_id, v_due_at;

  insert into public.notification_email_batch_items (
    organization_id, batch_id, event_id, recipient_user_id, lead_id, lead_title
  ) values (
    v_event.organization_id,
    v_batch_id,
    p_event_id,
    p_recipient_user_id,
    v_event.entity_id,
    coalesce(nullif(trim(v_title), ''), 'Lead sem nome')
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
    v_event.organization_id,
    'notification.email_batch_due',
    'notification_email_batch',
    v_batch_id,
    jsonb_build_object('kind', 'new_lead'),
    jsonb_build_object('source_event_id', p_event_id),
    v_due_at
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
  'Outbox de resumos de lead novo, agrupada por organização e destinatário.';
comment on table public.notification_email_batch_items is
  'Eventos únicos que compõem cada resumo de lead novo.';
