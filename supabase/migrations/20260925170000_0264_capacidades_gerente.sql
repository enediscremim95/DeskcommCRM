-- Gerente e administrador compartilham o mesmo acesso geral.
-- As duas exceções de produto são capacidades nomeadas, não degraus do role.

create or replace function public.fn_role_at_least(p_org uuid, p_min text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  with levels(role, lvl) as (
    values ('viewer',1),('agent',2),('manager',4),('admin',4)
  )
  select coalesce(
    (select user_lvl.lvl >= min_lvl.lvl
       from levels user_lvl
       join levels min_lvl on min_lvl.role = p_min
      where user_lvl.role = public.fn_user_role_in_org(p_org)),
    false
  );
$$;

create or replace function public.fn_user_role_in(p_org uuid)
returns integer
language sql stable security definer
set search_path = public
as $$
  select case public.fn_user_role_in_org(p_org)
    when 'viewer'  then 1
    when 'agent'   then 2
    when 'manager' then 4
    when 'admin'   then 4
    else 0
  end;
$$;

create or replace function public.fn_has_capability(p_org uuid, p_capability text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select case p_capability
    when 'team.manage' then public.fn_is_platform_admin()
      or public.fn_user_role_in_org(p_org) = 'manager'
    when 'lead.delete' then public.fn_is_platform_admin()
      or public.fn_user_role_in_org(p_org) = 'manager'
    else false
  end;
$$;

alter function public.fn_has_capability(uuid, text) owner to postgres;
revoke execute on function public.fn_has_capability(uuid, text) from public, anon;
grant execute on function public.fn_has_capability(uuid, text) to authenticated, service_role;

comment on column public.user_organizations.role is
  'Papéis canônicos: viewer (1) < agent (2) < manager (4) = admin (4) no acesso geral; team.manage e lead.delete são capacidades nomeadas.';

-- As funções de marca recebem `p_actor` explícito e por isso não podem usar
-- `fn_role_at_least`, que lê auth.uid(). Recria a definição vigente trocando
-- somente o predicado do papel, e falha se o formato esperado tiver mudado.
do $capability$
declare
  v_function regprocedure;
  v_definition text;
  v_updated text;
begin
  foreach v_function in array array[
    'public.fn_definir_marca_da_organizacao(uuid,uuid,jsonb)'::regprocedure,
    'public.fn_definir_logo_da_organizacao(uuid,uuid,text)'::regprocedure
  ] loop
    select pg_get_functiondef(v_function) into v_definition;
    v_updated := replace(
      v_definition,
      'and uo.role = ''admin''',
      'and uo.role in (''manager'', ''admin'')'
    );
    if v_updated = v_definition then
      raise exception 'capacidade_gerente_funcao_sem_predicado_esperado: %', v_function;
    end if;
    execute v_updated;
  end loop;
end
$capability$;

drop policy if exists user_orgs_insert on public.user_organizations;
create policy user_orgs_insert on public.user_organizations
  for insert to authenticated
  with check (public.fn_has_capability(organization_id, 'team.manage'));

drop policy if exists user_orgs_update on public.user_organizations;
create policy user_orgs_update on public.user_organizations
  for update to authenticated
  using (public.fn_has_capability(organization_id, 'team.manage'))
  with check (public.fn_has_capability(organization_id, 'team.manage'));

drop policy if exists user_orgs_delete on public.user_organizations;
create policy user_orgs_delete on public.user_organizations
  for delete to authenticated
  using (public.fn_has_capability(organization_id, 'team.manage'));

drop policy if exists crm_leads_delete on public.crm_leads;
create policy crm_leads_delete on public.crm_leads
  for delete to authenticated
  using (public.fn_has_capability(organization_id, 'lead.delete'));
