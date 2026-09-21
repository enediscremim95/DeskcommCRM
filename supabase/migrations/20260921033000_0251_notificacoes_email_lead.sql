-- Notificações por e-mail: opt-out pessoal e outbox deduplicado para urgências.

create table if not exists public.notification_email_preferences (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  new_lead boolean not null default true,
  urgent_lead boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

alter table public.notification_email_preferences enable row level security;

drop policy if exists notification_email_preferences_select on public.notification_email_preferences;
drop policy if exists notification_email_preferences_insert on public.notification_email_preferences;
drop policy if exists notification_email_preferences_update on public.notification_email_preferences;

create policy notification_email_preferences_select
  on public.notification_email_preferences
  for select
  using (
    user_id = auth.uid()
    and organization_id in (select public.fn_user_org_ids())
  );

create policy notification_email_preferences_insert
  on public.notification_email_preferences
  for insert
  with check (
    user_id = auth.uid()
    and organization_id in (select public.fn_user_org_ids())
  );

create policy notification_email_preferences_update
  on public.notification_email_preferences
  for update
  using (
    user_id = auth.uid()
    and organization_id in (select public.fn_user_org_ids())
  )
  with check (
    user_id = auth.uid()
    and organization_id in (select public.fn_user_org_ids())
  );

revoke all on table public.notification_email_preferences from anon;
grant select, insert, update on table public.notification_email_preferences to authenticated;
grant all on table public.notification_email_preferences to service_role;

drop trigger if exists trg_notification_email_preferences_updated_at
  on public.notification_email_preferences;
create trigger trg_notification_email_preferences_updated_at
  before update on public.notification_email_preferences
  for each row execute function public.fn_set_updated_at();

create unique index if not exists event_log_email_dedupe_unique
  on public.event_log (organization_id, (metadata ->> 'email_dedupe_key'))
  where metadata ? 'email_dedupe_key';

create or replace function public.fn_emit_email_urgent_on_risk()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if new.bucket not in ('em_risco', 'critico') then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.bucket is not distinct from old.bucket then
    return new;
  end if;

  insert into public.event_log (
    organization_id, event_type, entity_kind, entity_id, payload, metadata
  ) values (
    new.organization_id,
    'lead.action_required',
    'crm_lead',
    new.lead_id,
    jsonb_build_object('reason', 'risk', 'risk', new.bucket),
    jsonb_build_object(
      'email_dedupe_key',
      'risk:' || new.lead_id::text || ':' || new.bucket || ':' || new.since::text
    )
  )
  on conflict do nothing;
  return new;
end;
$$;

revoke execute on function public.fn_emit_email_urgent_on_risk() from public, anon;
grant execute on function public.fn_emit_email_urgent_on_risk() to service_role;

drop trigger if exists trg_email_urgent_on_risk on public.crm_lead_risk_states;
create trigger trg_email_urgent_on_risk
  after insert or update of bucket on public.crm_lead_risk_states
  for each row execute function public.fn_emit_email_urgent_on_risk();

comment on table public.notification_email_preferences is
  'Opt-out pessoal por organização para os dois únicos avisos enviados por e-mail: lead novo e ação urgente.';
