-- Cartões prioritários do Relatório, escolhidos por organização.
-- NULL preserva o conjunto padrão do modelo para instalações existentes.
alter table public.traffic_dashboard_configs
  add column if not exists priority_metric_columns text[];

comment on column public.traffic_dashboard_configs.priority_metric_columns is
  'Métricas prioritárias do topo do Relatório, na ordem escolhida; null usa o padrão do modelo.';
