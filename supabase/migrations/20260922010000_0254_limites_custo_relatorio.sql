-- Limites de custo do Relatório rico, por organização e plataforma.
create table if not exists public.traffic_report_cost_thresholds (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  platform text not null,
  good_until numeric(18,4) not null,
  acceptable_until numeric(18,4) not null,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, platform),
  constraint traffic_report_cost_thresholds_platform_check
    check (platform in ('meta_ads', 'google_ads')),
  constraint traffic_report_cost_thresholds_values_check
    check (good_until >= 0 and acceptable_until >= good_until)
);

alter table public.traffic_report_cost_thresholds enable row level security;
drop policy if exists tenant_isolation_traffic_report_cost_thresholds_all on public.traffic_report_cost_thresholds;
create policy tenant_isolation_traffic_report_cost_thresholds_all
  on public.traffic_report_cost_thresholds
  for all to authenticated
  using (organization_id in (select public.fn_user_org_ids()))
  with check (organization_id in (select public.fn_user_org_ids()));

revoke all on public.traffic_report_cost_thresholds from anon, authenticated;
grant select on public.traffic_report_cost_thresholds to authenticated;
grant select, insert, update, delete on public.traffic_report_cost_thresholds to service_role;

drop trigger if exists trg_traffic_report_cost_thresholds_updated_at
  on public.traffic_report_cost_thresholds;
create trigger trg_traffic_report_cost_thresholds_updated_at
  before update on public.traffic_report_cost_thresholds
  for each row execute function public.fn_set_updated_at();

comment on table public.traffic_report_cost_thresholds is
  'Limites de custo por resultado, isolados por organização e plataforma.';
