-- Padrão de colunas da tabela de campanhas por organização.
-- A preferência individual permanece no navegador de cada pessoa.
alter table public.traffic_dashboard_configs
  add column if not exists campaign_metric_columns text[];

comment on column public.traffic_dashboard_configs.campaign_metric_columns is
  'Colunas padrão da tabela de campanhas definidas pelo admin da plataforma; null usa o preset do modelo.';
