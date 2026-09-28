-- Limita quantas conversas a IA pode entregar ao mesmo tempo por canal.
-- Atendimento e follow-up compartilham a mesma lease. Espera nunca ocupa worker.

alter table public.channel_sessions
  add column if not exists max_concurrent_ai_conversations smallint not null default 1;

alter table public.channel_sessions
  drop constraint if exists channel_sessions_max_concurrent_ai_conversations_check;
alter table public.channel_sessions
  add constraint channel_sessions_max_concurrent_ai_conversations_check
  check (max_concurrent_ai_conversations between 1 and 20);

create table if not exists public.channel_delivery_leases (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  channel_session_id uuid not null references public.channel_sessions(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  job_id uuid not null references public.job_queue(id) on delete cascade,
  acquired_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (channel_session_id, conversation_id),
  unique (job_id)
);

create index if not exists channel_delivery_leases_active_idx
  on public.channel_delivery_leases (channel_session_id, expires_at);

alter table public.channel_delivery_leases enable row level security;
drop policy if exists channel_delivery_leases_tenant on public.channel_delivery_leases;
create policy channel_delivery_leases_tenant
  on public.channel_delivery_leases for all to authenticated
  using (organization_id in (select public.fn_user_org_ids()))
  with check (organization_id in (select public.fn_user_org_ids()));

revoke all on table public.channel_delivery_leases from anon, authenticated;
grant all on table public.channel_delivery_leases to service_role;

create or replace function public.fn_try_acquire_channel_delivery_lease(
  p_organization_id uuid,
  p_conversation_id uuid,
  p_job_id uuid,
  p_ttl_seconds integer default 960
) returns table(acquired boolean, retry_after_ms integer)
language plpgsql
set search_path = public
as $$
declare
  v_channel_session_id uuid;
  v_limit integer;
  v_active integer;
  v_next_expiry timestamptz;
begin
  if p_ttl_seconds < 30 or p_ttl_seconds > 3600 then
    raise exception 'invalid_channel_delivery_lease_ttl';
  end if;

  select c.channel_session_id, s.max_concurrent_ai_conversations
    into v_channel_session_id, v_limit
    from public.conversations c
    join public.channel_sessions s
      on s.id = c.channel_session_id
     and s.organization_id = c.organization_id
   where c.id = p_conversation_id
     and c.organization_id = p_organization_id
   for update of s;

  if v_channel_session_id is null then
    raise exception 'channel_session_not_found';
  end if;

  delete from public.channel_delivery_leases
   where channel_session_id = v_channel_session_id
     and expires_at <= now();

  update public.channel_delivery_leases
     set acquired_at = now(),
         expires_at = now() + make_interval(secs => p_ttl_seconds)
   where channel_session_id = v_channel_session_id
     and conversation_id = p_conversation_id
     and job_id = p_job_id;
  if found then
    return query select true, 0;
    return;
  end if;

  select count(*)::integer, min(expires_at)
    into v_active, v_next_expiry
    from public.channel_delivery_leases
   where channel_session_id = v_channel_session_id
     and expires_at > now();

  if v_active >= coalesce(v_limit, 1) then
    return query select false,
      greatest(1000, least(60000,
        ceil(extract(epoch from (v_next_expiry - now())) * 1000)::integer));
    return;
  end if;

  insert into public.channel_delivery_leases (
    organization_id, channel_session_id, conversation_id, job_id, expires_at
  ) values (
    p_organization_id, v_channel_session_id, p_conversation_id, p_job_id,
    now() + make_interval(secs => p_ttl_seconds)
  );

  return query select true, 0;
end;
$$;

create or replace function public.fn_release_channel_delivery_lease(
  p_organization_id uuid,
  p_job_id uuid
) returns void
language sql
set search_path = public
as $$
  delete from public.channel_delivery_leases
   where organization_id = p_organization_id
     and job_id = p_job_id;
$$;

revoke execute on function public.fn_try_acquire_channel_delivery_lease(uuid, uuid, uuid, integer)
  from public, anon, authenticated;
revoke execute on function public.fn_release_channel_delivery_lease(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.fn_try_acquire_channel_delivery_lease(uuid, uuid, uuid, integer)
  to service_role;
grant execute on function public.fn_release_channel_delivery_lease(uuid, uuid)
  to service_role;
