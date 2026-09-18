-- 0247_conector_whatsapp_gerenciado
--
-- Permite que uma organizacao use uma instancia Evolution ja existente como
-- conector de WhatsApp, sem o CRM criar, apagar ou reconfigurar essa instancia.
-- A chave fica cifrada. A reserva de QR e o registro de transicao de estado sao
-- atomicos para impedir rajadas de pareamento e hooks duplicados.

alter table public.channel_sessions
  add column if not exists evolution_base_url text,
  add column if not exists evolution_instance_name text,
  add column if not exists evolution_api_key_encrypted bytea,
  add column if not exists evolution_reconnect_hook_url text,
  add column if not exists evolution_remote_state text,
  add column if not exists evolution_qr_last_requested_at timestamptz,
  add column if not exists evolution_qr_attempt_count integer not null default 0,
  add column if not exists evolution_hook_last_status text,
  add column if not exists evolution_hook_last_error text,
  add column if not exists evolution_hook_last_attempt_at timestamptz,
  add column if not exists evolution_connected_at timestamptz;

alter table public.channel_sessions
  drop constraint if exists channel_sessions_provider_check;
alter table public.channel_sessions
  add constraint channel_sessions_provider_check
  check (provider = any (array['waha', 'meta_cloud', 'zernio', 'wacalls', 'evolution']));

alter table public.channel_sessions
  drop constraint if exists channel_sessions_provider_ref_check;
alter table public.channel_sessions
  add constraint channel_sessions_provider_ref_check
  check (
    ((provider = 'waha') and (waha_session_name is not null))
    or ((provider = 'meta_cloud') and (meta_phone_number_id is not null))
    or ((provider = 'zernio') and (zernio_account_id is not null))
    or ((provider = 'wacalls') and (wacalls_session_id is not null))
    or (
      (provider = 'evolution')
      and (evolution_base_url is not null)
      and (evolution_instance_name is not null)
      and (evolution_api_key_encrypted is not null)
      and (phone_number is not null)
    )
  );

alter table public.channel_sessions
  drop constraint if exists channel_sessions_evolution_qr_attempt_count_check;
alter table public.channel_sessions
  add constraint channel_sessions_evolution_qr_attempt_count_check
  check (evolution_qr_attempt_count between 0 and 3);

alter table public.channel_sessions
  drop constraint if exists channel_sessions_evolution_remote_state_check;
alter table public.channel_sessions
  add constraint channel_sessions_evolution_remote_state_check
  check (evolution_remote_state is null or evolution_remote_state in ('open', 'close', 'connecting'));

create unique index if not exists channel_sessions_evolution_org_active_unique
  on public.channel_sessions (organization_id)
  where provider = 'evolution' and archived_at is null;

create or replace function public.fn_channel_connector_exclusivity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.archived_at is not null or new.provider not in ('waha', 'evolution') then
    return new;
  end if;

  if exists (
    select 1
      from public.channel_sessions other
     where other.organization_id = new.organization_id
       and other.id <> new.id
       and other.archived_at is null
       and other.provider = case when new.provider = 'waha' then 'evolution' else 'waha' end
  ) then
    raise exception 'channel_connector_conflict' using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke execute on function public.fn_channel_connector_exclusivity() from public, anon, authenticated;

drop trigger if exists trg_channel_connector_exclusivity on public.channel_sessions;
create trigger trg_channel_connector_exclusivity
  before insert or update of provider, organization_id, archived_at
  on public.channel_sessions
  for each row execute function public.fn_channel_connector_exclusivity();

create or replace function public.fn_reserve_managed_channel_qr(
  p_org uuid,
  p_session uuid
)
returns table(allowed boolean, retry_after_seconds integer, attempts integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.channel_sessions%rowtype;
  v_now timestamptz := now();
begin
  if auth.role() <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_row
    from public.channel_sessions
   where id = p_session
     and organization_id = p_org
     and provider = 'evolution'
     and archived_at is null
   for update;

  if not found then
    raise exception 'managed_channel_not_found' using errcode = 'P0002';
  end if;

  if v_row.evolution_qr_last_requested_at is not null
     and v_row.evolution_qr_last_requested_at > v_now - interval '1 minute' then
    return query select false,
      greatest(1, ceil(extract(epoch from (v_row.evolution_qr_last_requested_at + interval '1 minute' - v_now)))::integer),
      v_row.evolution_qr_attempt_count;
    return;
  end if;

  if v_row.evolution_qr_attempt_count >= 3 then
    return query select false, 0, v_row.evolution_qr_attempt_count;
    return;
  end if;

  update public.channel_sessions
     set evolution_qr_last_requested_at = v_now,
         evolution_qr_attempt_count = v_row.evolution_qr_attempt_count + 1,
         updated_at = v_now
   where id = p_session and organization_id = p_org;

  return query select true, 0, v_row.evolution_qr_attempt_count + 1;
end;
$$;

revoke execute on function public.fn_reserve_managed_channel_qr(uuid, uuid) from public, anon, authenticated;
grant execute on function public.fn_reserve_managed_channel_qr(uuid, uuid) to service_role;

create or replace function public.fn_record_managed_channel_state(
  p_org uuid,
  p_session uuid,
  p_state text
)
returns table(transitioned_to_open boolean, previous_state text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_previous text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_state not in ('open', 'close', 'connecting') then
    raise exception 'invalid_managed_channel_state' using errcode = '22023';
  end if;

  select evolution_remote_state into v_previous
    from public.channel_sessions
   where id = p_session
     and organization_id = p_org
     and provider = 'evolution'
     and archived_at is null
   for update;

  if not found then
    raise exception 'managed_channel_not_found' using errcode = 'P0002';
  end if;

  update public.channel_sessions
     set evolution_remote_state = p_state,
         status = case p_state when 'open' then 'WORKING' when 'connecting' then 'SCAN_QR_CODE' else 'STOPPED' end,
         status_reason = case when p_state = 'close' then 'remote_disconnected' else null end,
         last_health_check_at = now(),
         last_status_change_at = case when evolution_remote_state is distinct from p_state then now() else last_status_change_at end,
         evolution_connected_at = case when p_state = 'open' then coalesce(evolution_connected_at, now()) else evolution_connected_at end,
         evolution_qr_attempt_count = case when p_state = 'open' then 0 else evolution_qr_attempt_count end,
         updated_at = now()
   where id = p_session and organization_id = p_org;

  return query select (v_previous is distinct from 'open' and p_state = 'open'), v_previous;
end;
$$;

revoke execute on function public.fn_record_managed_channel_state(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.fn_record_managed_channel_state(uuid, uuid, text) to service_role;
