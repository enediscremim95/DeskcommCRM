-- Predefinições nomeadas de colunas do Relatório, isoladas por organização.
-- A seleção momentânea continua local ao navegador; somente o admin da
-- plataforma muta presets pelas rotas server-side.
create table if not exists public.traffic_dashboard_column_presets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  metric_columns text[] not null,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint traffic_dashboard_column_presets_name_check
    check (char_length(btrim(name)) between 1 and 80),
  constraint traffic_dashboard_column_presets_columns_check
    check (
      cardinality(metric_columns) between 1 and 22
      and metric_columns <@ array[
        'budget', 'spend', 'reach', 'impressions', 'cpm', 'ctr', 'link_clicks',
        'cpc', 'landing_page_views', 'cost_per_landing_page_view', 'leads',
        'cost_per_lead', 'add_to_cart', 'cost_per_add_to_cart',
        'initiate_checkout', 'cost_per_initiate_checkout', 'purchases',
        'cost_per_purchase', 'revenue', 'roas', 'messaging_conversations',
        'cost_per_messaging_conversation'
      ]::text[]
    )
);

create unique index if not exists traffic_dashboard_column_presets_org_name_uk
  on public.traffic_dashboard_column_presets (organization_id, lower(btrim(name)));
create unique index if not exists traffic_dashboard_column_presets_org_id_uk
  on public.traffic_dashboard_column_presets (organization_id, id);
create index if not exists traffic_dashboard_column_presets_org_updated_idx
  on public.traffic_dashboard_column_presets (organization_id, updated_at desc);

alter table public.traffic_dashboard_configs
  add column if not exists default_column_preset_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'traffic_dashboard_configs_default_column_preset_fk'
       and conrelid = 'public.traffic_dashboard_configs'::regclass
  ) then
    alter table public.traffic_dashboard_configs
      add constraint traffic_dashboard_configs_default_column_preset_fk
      foreign key (organization_id, default_column_preset_id)
      references public.traffic_dashboard_column_presets(organization_id, id)
      on delete set null (default_column_preset_id);
  end if;
end $$;

alter table public.traffic_dashboard_column_presets enable row level security;
drop policy if exists tenant_isolation_traffic_dashboard_column_presets_all on public.traffic_dashboard_column_presets;
create policy tenant_isolation_traffic_dashboard_column_presets_all
  on public.traffic_dashboard_column_presets
  for all to authenticated
  using (organization_id in (select public.fn_user_org_ids()))
  with check (organization_id in (select public.fn_user_org_ids()));

revoke all on public.traffic_dashboard_column_presets from anon, authenticated;
grant select on public.traffic_dashboard_column_presets to authenticated;
grant select, insert, update, delete on public.traffic_dashboard_column_presets to service_role;

drop trigger if exists trg_traffic_dashboard_column_presets_updated_at
  on public.traffic_dashboard_column_presets;
create trigger trg_traffic_dashboard_column_presets_updated_at
  before update on public.traffic_dashboard_column_presets
  for each row execute function public.fn_set_updated_at();

comment on table public.traffic_dashboard_column_presets is
  'Predefinições nomeadas e ordenadas de métricas do Relatório, isoladas por organização.';
comment on column public.traffic_dashboard_configs.default_column_preset_id is
  'Preset padrão da organização; null mantém compatibilidade com campaign_metric_columns.';
