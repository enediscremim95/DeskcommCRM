-- 0272: zerar a organização e gerir tokens são capacidades nomeadas.
--
-- A 0264 igualou manager e admin no acesso geral. Estas duas operações não
-- podem herdar esse empate: uma apaga a operação inteira e a outra cria ou
-- revoga o bearer que mantém integrações de produção funcionando.

create or replace function public.fn_has_capability(p_org uuid, p_capability text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select case p_capability
    when 'team.manage' then public.fn_is_platform_admin()
      or public.fn_user_role_in_org(p_org) = 'manager'
      or public.fn_user_role_in_org(p_org) = 'admin'
    when 'lead.delete' then public.fn_is_platform_admin()
      or public.fn_user_role_in_org(p_org) = 'manager'
    when 'ai.credentials.delete' then public.fn_is_platform_admin()
      or public.fn_user_role_in_org(p_org) = 'admin'
    when 'organization.data.reset' then public.fn_is_platform_admin()
      or public.fn_user_role_in_org(p_org) = 'admin'
    when 'api.tokens.manage' then public.fn_is_platform_admin()
      or public.fn_user_role_in_org(p_org) = 'admin'
    else false
  end;
$$;

alter function public.fn_has_capability(uuid, text) owner to postgres;
revoke execute on function public.fn_has_capability(uuid, text) from public, anon;
grant execute on function public.fn_has_capability(uuid, text) to authenticated, service_role;

-- Leitura continua acompanhando o acesso amplo. Criação, revogação (UPDATE)
-- e remoção direta exigem a capacidade irreversível.
drop policy if exists api_tokens_admin_only on public.api_tokens;
drop policy if exists api_tokens_select on public.api_tokens;
create policy api_tokens_select
  on public.api_tokens for select to authenticated
  using (
    public.fn_role_at_least(organization_id, 'admin')
    or public.fn_is_platform_admin()
  );

drop policy if exists api_tokens_insert on public.api_tokens;
create policy api_tokens_insert
  on public.api_tokens for insert to authenticated
  with check (public.fn_has_capability(organization_id, 'api.tokens.manage'));

drop policy if exists api_tokens_update on public.api_tokens;
create policy api_tokens_update
  on public.api_tokens for update to authenticated
  using (public.fn_has_capability(organization_id, 'api.tokens.manage'))
  with check (public.fn_has_capability(organization_id, 'api.tokens.manage'));

drop policy if exists api_tokens_delete on public.api_tokens;
create policy api_tokens_delete
  on public.api_tokens for delete to authenticated
  using (public.fn_has_capability(organization_id, 'api.tokens.manage'));

comment on column public.user_organizations.role is
  'Papéis canônicos: viewer (1) < agent (2) < manager (4) = admin (4) no acesso geral; operações irreversíveis usam capacidades nomeadas.';

notify pgrst, 'reload schema';
