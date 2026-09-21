-- Guarda no snapshot Windsor a régua de atividade e os destinos dos anúncios.
-- O PDF consome somente a geração publicada da organização, sem nova chamada externa.

alter table public.traffic_dashboard_facts
  add column if not exists campaign_status text,
  add column if not exists destination_urls text[] not null default '{}'::text[];

comment on column public.traffic_dashboard_facts.campaign_status is
  'Status de campanha informado pelo Windsor na sincronização; null aciona fallback explícito por investimento.';

comment on column public.traffic_dashboard_facts.destination_urls is
  'URLs brutas de destino informadas pelo Windsor; limpeza e deduplicação ocorrem na leitura do relatório.';
