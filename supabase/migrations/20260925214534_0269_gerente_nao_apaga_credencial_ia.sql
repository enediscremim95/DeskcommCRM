-- 0267: apagar credencial de IA é capacidade nomeada de admin/plataforma.
--
-- A 0264 igualou manager e admin no acesso geral. Como a policy da 0150 era
-- FOR ALL com fn_role_at_least(..., 'admin'), o novo rank também entregou ao
-- manager o DELETE da credencial por efeito colateral. Esta operação não pode
-- seguir a escada: a chave do provedor sustenta o atendimento inteiro, e uma
-- exclusão acidental derruba o agente de todos os clientes da organização.
--
-- Manager continua criando, atualizando e revalidando credenciais. Somente o
-- DELETE fica com admin da organização e administrador de plataforma.

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
    else false
  end;
$$;

alter function public.fn_has_capability(uuid, text) owner to postgres;
revoke execute on function public.fn_has_capability(uuid, text) from public, anon;
grant execute on function public.fn_has_capability(uuid, text) to authenticated, service_role;

drop policy if exists tenant_isolation_ai_provider_credentials_write on public.ai_provider_credentials;
drop policy if exists tenant_isolation_ai_provider_credentials_insert on public.ai_provider_credentials;
create policy tenant_isolation_ai_provider_credentials_insert
  on public.ai_provider_credentials for insert to authenticated
  with check (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin'))
    or public.fn_is_platform_admin()
  );

drop policy if exists tenant_isolation_ai_provider_credentials_update on public.ai_provider_credentials;
create policy tenant_isolation_ai_provider_credentials_update
  on public.ai_provider_credentials for update to authenticated
  using (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin'))
    or public.fn_is_platform_admin()
  )
  with check (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin'))
    or public.fn_is_platform_admin()
  );

drop policy if exists tenant_isolation_ai_provider_credentials_delete on public.ai_provider_credentials;
create policy tenant_isolation_ai_provider_credentials_delete
  on public.ai_provider_credentials for delete to authenticated
  using (public.fn_has_capability(organization_id, 'ai.credentials.delete'));

comment on column public.user_organizations.role is
  'Papéis canônicos: viewer (1) < agent (2) < manager (4) = admin (4) no acesso geral; team.manage, lead.delete e ai.credentials.delete são capacidades nomeadas.';

notify pgrst, 'reload schema';
