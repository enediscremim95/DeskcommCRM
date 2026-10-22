-- Funil objetivo do relatório em slides da Bendito Ponto.
--
-- Aplicar sem expor credenciais:
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/migrations/20261019120000_0292_funil_objetivo_relatorio_bendito_ponto.sql
--
-- Reverter somente esta configuração, preservando as demais chaves de settings:
--   update public.crm_pipelines
--      set settings = coalesce(settings, '{}'::jsonb) - 'report_funnel',
--          updated_at = now()
--    where organization_id = '4db279eb-55d6-44a3-870f-9909f19f8b87'::uuid
--      and name = 'Funil de vendas';

with report_funnel_config as (
  select jsonb_build_array(
       jsonb_build_object('label', 'Leads', 'stage_names', jsonb_build_array()),
       jsonb_build_object(
         'label', 'Leads contactados',
         'stage_names', jsonb_build_array('Contato Realizado')
       ),
       jsonb_build_object(
         'label', 'Leads qualificados',
         'stage_names', jsonb_build_array('Reunião Agendada', 'Reuniao Agendada')
       ),
       jsonb_build_object(
         'label', 'Reuniões realizadas',
         'stage_names', jsonb_build_array('Reunião Realizada', 'Reuniao Realizada')
       ),
       jsonb_build_object('label', 'COF', 'stage_names', jsonb_build_array('COF Enviada')),
       jsonb_build_object(
         'label', 'Vendas fechadas',
         'stage_names', jsonb_build_array('Contrato')
       )
     ) as value
)
update public.crm_pipelines as pipeline
   set settings = coalesce(pipeline.settings, '{}'::jsonb) || jsonb_build_object(
         'report_funnel', config.value
       ),
       updated_at = now()
  from report_funnel_config as config
 where organization_id = '4db279eb-55d6-44a3-870f-9909f19f8b87'::uuid
   and name = 'Funil de vendas'
   and pipeline.settings -> 'report_funnel' is distinct from config.value;
