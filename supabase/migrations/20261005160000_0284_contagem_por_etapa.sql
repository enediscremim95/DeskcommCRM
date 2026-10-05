-- 0284, uma contagem agrupada por carga do quadro.
--
-- A rota fazia um COUNT exato por etapa. Esta função mantém o mesmo recorte,
-- mas agrupa todas as etapas em uma única consulta. SECURITY INVOKER é parte
-- do contrato: crm_leads continua filtrada pela RLS e cada pessoa recebe apenas
-- as contagens dos negócios que pode ver.
--
-- REVERSÃO (rollback):
-- drop function if exists public.fn_contagem_por_etapa(uuid, uuid);

create or replace function public.fn_contagem_por_etapa(
  p_organization_id uuid,
  p_pipeline_id uuid
)
returns table (stage_id uuid, total bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select l.stage_id, count(*)::bigint as total
    from public.crm_leads l
   where l.organization_id = p_organization_id
     and l.pipeline_id = p_pipeline_id
     and l.status <> 'archived'
   group by l.stage_id;
$$;

revoke execute on function public.fn_contagem_por_etapa(uuid, uuid)
  from public, anon;
grant execute on function public.fn_contagem_por_etapa(uuid, uuid)
  to authenticated;

notify pgrst, 'reload schema';
