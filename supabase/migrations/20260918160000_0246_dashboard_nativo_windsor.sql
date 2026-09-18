-- 0246: dashboard de mídia nativo, alimentado pelo Windsor na própria VPS.
--
-- A chave é configuração da instalação e nunca entra no banco. O banco guarda
-- somente o recorte autorizado para cada organização e os fatos já normalizados.
-- As quatro tabelas são server-side only: RLS ligada, zero policies e grants de
-- anon/authenticated revogados. Toda leitura/escrita passa por handlers que
-- resolvem organization_id de cookie validado ou de rota protegida de platform admin.
create table if not exists public.traffic_dashboard_configs (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  model text not null,
  conversion_fields text[] not null,
  revenue_field text,
  enabled boolean not null default true,
  sync_status text not null default 'pending',
  last_sync_started_at timestamptz,
  last_sync_succeeded_at timestamptz,
  last_sync_error text,
  published_generation uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint traffic_dashboard_configs_model_check check (model in ('leads', 'messages', 'ecommerce')),
  constraint traffic_dashboard_configs_conversion_fields_check check (cardinality(conversion_fields) between 1 and 2),
  constraint traffic_dashboard_configs_sync_status_check check (sync_status in ('pending', 'syncing', 'ready', 'failed'))
);
create table if not exists public.traffic_dashboard_accounts (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id text not null,
  platform text not null,
  account_name text not null,
  currency text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, account_id),
  constraint traffic_dashboard_accounts_platform_check check (platform in ('meta_ads', 'google_ads')),
  constraint traffic_dashboard_accounts_currency_check check (currency ~ '^[A-Z]{3}$')
);
create table if not exists public.traffic_dashboard_facts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id text not null,
  platform text not null,
  occurred_on date not null,
  campaign_id text,
  campaign_name text not null default '',
  adset_id text,
  adset_name text not null default '',
  ad_id text,
  ad_name text not null default '',
  impressions numeric not null default 0,
  reach numeric not null default 0,
  clicks numeric not null default 0,
  link_clicks numeric not null default 0,
  spend numeric not null default 0,
  conversions jsonb not null default '{}'::jsonb,
  revenue numeric not null default 0,
  video_views numeric not null default 0,
  video_p25 numeric not null default 0,
  video_p50 numeric not null default 0,
  video_p75 numeric not null default 0,
  video_p95 numeric not null default 0,
  thumbnail_url text,
  story_id text,
  source_key text not null,
  sync_generation uuid not null,
  synced_at timestamptz not null default now(),
  constraint traffic_dashboard_facts_platform_check check (platform in ('meta_ads', 'google_ads')),
  constraint traffic_dashboard_facts_metrics_nonnegative_check check (
    impressions >= 0 and reach >= 0 and clicks >= 0 and link_clicks >= 0
    and spend >= 0 and revenue >= 0 and video_views >= 0
    and video_p25 >= 0 and video_p50 >= 0 and video_p75 >= 0 and video_p95 >= 0
  ),
  constraint traffic_dashboard_facts_account_fk foreign key (organization_id, account_id)
    references public.traffic_dashboard_accounts(organization_id, account_id) on delete cascade
);
create unique index if not exists traffic_dashboard_facts_source_uk
  on public.traffic_dashboard_facts (organization_id, account_id, source_key);
create index if not exists traffic_dashboard_facts_period_idx
  on public.traffic_dashboard_facts (organization_id, occurred_on desc);
create index if not exists traffic_dashboard_facts_generation_idx
  on public.traffic_dashboard_facts (organization_id, sync_generation);
create table if not exists public.traffic_dashboard_sync_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  status text not null,
  trigger text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  rows_received integer not null default 0,
  rows_written integer not null default 0,
  duplicates_removed integer not null default 0,
  error_code text,
  error_message text,
  constraint traffic_dashboard_sync_runs_status_check check (status in ('running', 'succeeded', 'failed')),
  constraint traffic_dashboard_sync_runs_trigger_check check (trigger in ('cron', 'manual'))
);
create index if not exists traffic_dashboard_sync_runs_org_started_idx
  on public.traffic_dashboard_sync_runs (organization_id, started_at desc);
alter table public.traffic_dashboard_configs enable row level security;
alter table public.traffic_dashboard_accounts enable row level security;
alter table public.traffic_dashboard_facts enable row level security;
alter table public.traffic_dashboard_sync_runs enable row level security;
revoke all on public.traffic_dashboard_configs from anon, authenticated;
revoke all on public.traffic_dashboard_accounts from anon, authenticated;
revoke all on public.traffic_dashboard_facts from anon, authenticated;
revoke all on public.traffic_dashboard_sync_runs from anon, authenticated;
grant select, insert, update, delete on public.traffic_dashboard_configs to service_role;
grant select, insert, update, delete on public.traffic_dashboard_accounts to service_role;
grant select, insert, update, delete on public.traffic_dashboard_facts to service_role;
grant select, insert, update, delete on public.traffic_dashboard_sync_runs to service_role;
create or replace function public.fn_configure_traffic_dashboard(
  p_organization_id uuid, p_actor uuid, p_model text,
  p_conversion_fields text[], p_revenue_field text, p_accounts jsonb
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from public.platform_admins
    where user_id = p_actor and revoked_at is null and scope = 'full') then
    raise exception 'platform_admin_required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.organizations where id = p_organization_id) then
    raise exception 'organization_not_found' using errcode = '22023';
  end if;
  insert into public.traffic_dashboard_configs (
    organization_id, model, conversion_fields, revenue_field, enabled,
    sync_status, last_sync_error, updated_by
  ) values (
    p_organization_id, p_model, p_conversion_fields, p_revenue_field, true,
    'pending', null, p_actor
  )
  on conflict (organization_id) do update set
    model = excluded.model, conversion_fields = excluded.conversion_fields,
    revenue_field = excluded.revenue_field, enabled = true,
    sync_status = 'pending', last_sync_error = null, updated_by = excluded.updated_by;

  delete from public.traffic_dashboard_accounts
   where organization_id = p_organization_id
     and account_id not in (select value->>'account_id' from jsonb_array_elements(p_accounts));
  insert into public.traffic_dashboard_accounts (
    organization_id, account_id, platform, account_name, currency
  )
  select p_organization_id, value->>'account_id', value->>'platform',
         value->>'account_name', upper(value->>'currency')
    from jsonb_array_elements(p_accounts)
  on conflict (organization_id, account_id) do update set
    platform = excluded.platform, account_name = excluded.account_name,
    currency = excluded.currency;
end $$;
revoke execute on function public.fn_configure_traffic_dashboard(uuid,uuid,text,text[],text,jsonb)
  from public, anon, authenticated;
grant execute on function public.fn_configure_traffic_dashboard(uuid,uuid,text,text[],text,jsonb)
  to service_role;

drop trigger if exists trg_traffic_dashboard_configs_updated_at on public.traffic_dashboard_configs;
create trigger trg_traffic_dashboard_configs_updated_at before update on public.traffic_dashboard_configs
  for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_traffic_dashboard_accounts_updated_at on public.traffic_dashboard_accounts;
create trigger trg_traffic_dashboard_accounts_updated_at before update on public.traffic_dashboard_accounts
  for each row execute function public.fn_set_updated_at();
comment on table public.traffic_dashboard_configs is
  'Configuração do dashboard nativo por organização. A chave Windsor é da instalação e nunca é persistida.';
comment on table public.traffic_dashboard_facts is
  'Fatos Windsor já deduplicados e recortados por account_id e organization_id; a tela nunca chama a origem.';
