-- 0290, leitura barata de crm_leads para atendentes sem alterar o conjunto visível.
--
-- A 0283 promoveu plataforma e papéis de leitura total a InitPlans, mas o
-- atendente ainda caía em fn_can_view_lead por negócio. Os dois auxiliares
-- abaixo leem visibility_mode uma vez por consulta e materializam os modos em
-- que o atendente pode ver toda a organização ou também a fila sem dono.
-- fn_can_view_lead permanece como a última reserva de compatibilidade.
--
-- REVERSÃO (rollback):
-- drop policy if exists "crm_leads_select" on public.crm_leads;
-- create policy "crm_leads_select" on public.crm_leads
--   for select using (
--     (select public.fn_is_platform_admin())
--     or organization_id = any(((select public.fn_orgs_leitura_total()))::uuid[])
--     or public.fn_can_view_lead(organization_id, owner_user_id)
--   );
-- drop function if exists public.fn_orgs_atendente_leitura_sem_dono();
-- drop function if exists public.fn_orgs_atendente_leitura_total();

create or replace function public.fn_orgs_atendente_leitura_total()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select array(
    with contexto as (
      select public.fn_support_context() as suporte
    )
    select uo.organization_id
      from public.user_organizations uo
      join public.organizations o on o.id = uo.organization_id
      cross join contexto c
     where uo.user_id = auth.uid()
       and uo.revoked_at is null
       and uo.role = 'agent'
       and coalesce(o.settings->>'visibility_mode', 'own_and_unassigned') = 'all'
       -- Suporte ativo substitui o vínculo na organização-alvo, igual a
       -- fn_user_role_in_org. O alvo já entra em fn_orgs_leitura_total.
       and not (
         coalesce(c.suporte->>'status' = 'active', false)
         and uo.organization_id = nullif(c.suporte->>'organization_id', '')::uuid
       )
     order by uo.organization_id
  );
$$;

create or replace function public.fn_orgs_atendente_leitura_sem_dono()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select array(
    with contexto as (
      select public.fn_support_context() as suporte
    )
    select uo.organization_id
      from public.user_organizations uo
      join public.organizations o on o.id = uo.organization_id
      cross join contexto c
     where uo.user_id = auth.uid()
       and uo.revoked_at is null
       and uo.role = 'agent'
       and coalesce(o.settings->>'visibility_mode', 'own_and_unassigned')
           in ('own_and_unassigned', 'all')
       and not (
         coalesce(c.suporte->>'status' = 'active', false)
         and uo.organization_id = nullif(c.suporte->>'organization_id', '')::uuid
       )
     order by uo.organization_id
  );
$$;

revoke execute on function public.fn_orgs_atendente_leitura_total() from public, anon;
revoke execute on function public.fn_orgs_atendente_leitura_sem_dono() from public, anon;
grant execute on function public.fn_orgs_atendente_leitura_total() to authenticated;
grant execute on function public.fn_orgs_atendente_leitura_sem_dono() to authenticated;

drop policy if exists "crm_leads_select" on public.crm_leads;
create policy "crm_leads_select" on public.crm_leads
  for select using (
    (select public.fn_is_platform_admin())
    or organization_id = any(((select public.fn_orgs_leitura_total()))::uuid[])
    or (
      -- O gate mantém "sem papel na organização = não vê", inclusive quando
      -- um vínculo revogado ainda consta em owner_user_id.
      organization_id in (select public.fn_user_org_ids())
      and (
        owner_user_id = (select auth.uid())
        or organization_id = any(((select public.fn_orgs_atendente_leitura_total()))::uuid[])
        or (
          owner_user_id is null
          and organization_id = any(((select public.fn_orgs_atendente_leitura_sem_dono()))::uuid[])
        )
        or public.fn_can_view_lead(organization_id, owner_user_id)
      )
    )
  );

notify pgrst, 'reload schema';
