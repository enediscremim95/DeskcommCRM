-- 0283, leitura barata de crm_leads sem alterar o conjunto visível.
--
-- O SELECT anterior chamava fn_can_view_lead para cada negócio, inclusive para
-- administradores de plataforma e papéis com leitura total da organização. A
-- política nova promove esses dois casos a InitPlans e preserva a função antiga
-- como reserva por linha para atendentes e qualquer caso não antecipado.
--
-- REVERSÃO (rollback):
-- drop policy if exists "crm_leads_select" on public.crm_leads;
-- create policy "crm_leads_select" on public.crm_leads
--   for select using (public.fn_can_view_lead(organization_id, owner_user_id));
-- drop function if exists public.fn_orgs_leitura_total();

create or replace function public.fn_orgs_leitura_total()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select array(
    with contexto as (
      select public.fn_support_context() as suporte
    ), organizacoes as (
      select uo.organization_id
        from public.user_organizations uo
        cross join contexto c
       where uo.user_id = auth.uid()
         and uo.revoked_at is null
         and uo.role in ('viewer', 'manager', 'admin')
         -- Suporte ativo vence o vínculo na organização-alvo, igual a
         -- fn_user_role_in_org. Os dois papéis de suporte têm leitura total.
         and not (
           coalesce(c.suporte->>'status' = 'active', false)
           and uo.organization_id = nullif(c.suporte->>'organization_id', '')::uuid
         )
      union
      select (c.suporte->>'organization_id')::uuid
        from contexto c
       where c.suporte->>'status' = 'active'
         and c.suporte->>'access_mode' in ('full', 'support_readonly')
    )
    select organization_id
      from organizacoes
     order by organization_id
  );
$$;

revoke execute on function public.fn_orgs_leitura_total() from public, anon;
grant execute on function public.fn_orgs_leitura_total() to authenticated;

drop policy if exists "crm_leads_select" on public.crm_leads;
create policy "crm_leads_select" on public.crm_leads
  for select using (
    (select public.fn_is_platform_admin())
    or organization_id = any((select public.fn_orgs_leitura_total()))
    or public.fn_can_view_lead(organization_id, owner_user_id)
  );

notify pgrst, 'reload schema';
