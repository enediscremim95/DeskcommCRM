-- Separa predefinições e padrões de colunas por plataforma sem perder escolhas existentes.
-- A linha legada conserva o id no Meta; uma cópia idempotente, já filtrada para
-- métricas disponíveis no Google, preserva a mesma predefinição na outra plataforma.
alter table public.traffic_dashboard_column_presets
  add column if not exists platform text;

drop index if exists public.traffic_dashboard_column_presets_org_name_uk;

update public.traffic_dashboard_column_presets
   set platform = 'meta_ads'
 where platform is null;

insert into public.traffic_dashboard_column_presets (
  organization_id,
  name,
  metric_columns,
  platform,
  created_by,
  updated_by,
  created_at,
  updated_at
)
select
  source.organization_id,
  source.name,
  case
    when cardinality(google_columns.metric_columns) > 0 then google_columns.metric_columns
    else array['spend', 'impressions', 'ctr', 'link_clicks', 'cpc']::text[]
  end,
  'google_ads',
  source.created_by,
  source.updated_by,
  source.created_at,
  source.updated_at
from public.traffic_dashboard_column_presets source
cross join lateral (
  select array_agg(metric.metric_name order by metric.position) as metric_columns
  from unnest(source.metric_columns) with ordinality as metric(metric_name, position)
  where metric.metric_name not in (
    'reach',
    'messaging_conversations',
    'cost_per_messaging_conversation'
  )
) google_columns
where source.platform = 'meta_ads'
  and not exists (
    select 1
      from public.traffic_dashboard_column_presets existing
     where existing.organization_id = source.organization_id
       and existing.platform = 'google_ads'
       and lower(btrim(existing.name)) = lower(btrim(source.name))
  );

alter table public.traffic_dashboard_column_presets
  alter column platform set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'traffic_dashboard_column_presets_platform_check'
       and conrelid = 'public.traffic_dashboard_column_presets'::regclass
  ) then
    alter table public.traffic_dashboard_column_presets
      add constraint traffic_dashboard_column_presets_platform_check
      check (platform in ('meta_ads', 'google_ads'));
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'traffic_dashboard_column_presets_google_columns_check'
       and conrelid = 'public.traffic_dashboard_column_presets'::regclass
  ) then
    alter table public.traffic_dashboard_column_presets
      add constraint traffic_dashboard_column_presets_google_columns_check
      check (
        platform <> 'google_ads'
        or not metric_columns && array[
          'reach',
          'messaging_conversations',
          'cost_per_messaging_conversation'
        ]::text[]
      );
  end if;
end $$;

create unique index if not exists traffic_dashboard_column_presets_org_platform_name_uk
  on public.traffic_dashboard_column_presets (
    organization_id,
    platform,
    lower(btrim(name))
  );
create unique index if not exists traffic_dashboard_column_presets_org_platform_id_uk
  on public.traffic_dashboard_column_presets (organization_id, platform, id);

alter table public.traffic_dashboard_configs
  add column if not exists default_meta_column_preset_id uuid,
  add column if not exists default_google_column_preset_id uuid;

update public.traffic_dashboard_configs
   set default_meta_column_preset_id = default_column_preset_id
 where default_meta_column_preset_id is null
   and default_column_preset_id is not null;

update public.traffic_dashboard_configs config
   set default_google_column_preset_id = google_preset.id
  from public.traffic_dashboard_column_presets meta_preset
  join public.traffic_dashboard_column_presets google_preset
    on google_preset.organization_id = meta_preset.organization_id
   and google_preset.platform = 'google_ads'
   and lower(btrim(google_preset.name)) = lower(btrim(meta_preset.name))
 where config.default_google_column_preset_id is null
   and config.default_column_preset_id = meta_preset.id
   and config.organization_id = meta_preset.organization_id
   and meta_preset.platform = 'meta_ads';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'traffic_dashboard_configs_default_meta_preset_fk'
       and conrelid = 'public.traffic_dashboard_configs'::regclass
  ) then
    alter table public.traffic_dashboard_configs
      add constraint traffic_dashboard_configs_default_meta_preset_fk
      foreign key (organization_id, default_meta_column_preset_id)
      references public.traffic_dashboard_column_presets(organization_id, id)
      on delete set null (default_meta_column_preset_id);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'traffic_dashboard_configs_default_google_preset_fk'
       and conrelid = 'public.traffic_dashboard_configs'::regclass
  ) then
    alter table public.traffic_dashboard_configs
      add constraint traffic_dashboard_configs_default_google_preset_fk
      foreign key (organization_id, default_google_column_preset_id)
      references public.traffic_dashboard_column_presets(organization_id, id)
      on delete set null (default_google_column_preset_id);
  end if;
end $$;

comment on column public.traffic_dashboard_column_presets.platform is
  'Plataforma cuja tabela de campanhas usa esta predefinição.';
comment on column public.traffic_dashboard_configs.default_meta_column_preset_id is
  'Predefinição padrão da tabela de campanhas do Meta Ads.';
comment on column public.traffic_dashboard_configs.default_google_column_preset_id is
  'Predefinição padrão da tabela de campanhas do Google Ads.';
