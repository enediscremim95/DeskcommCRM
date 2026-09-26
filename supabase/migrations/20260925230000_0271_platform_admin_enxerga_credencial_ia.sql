-- 0271: o administrador de plataforma precisa enxergar a linha para apagá-la.
--
-- A 0269 liberou o DELETE pela capacidade `ai.credentials.delete`, mas manteve
-- a policy de SELECT da 0207 restrita aos membros da organização. No PostgreSQL,
-- um DELETE com RETURNING também depende da visibilidade da linha; por isso
-- fn_has_capability() devolvia true para a plataforma e a operação afetava zero
-- linhas. O grant por coluna da 0150 continua escondendo o segredo cifrado.

drop policy if exists tenant_isolation_ai_provider_credentials_select
  on public.ai_provider_credentials;
create policy tenant_isolation_ai_provider_credentials_select
  on public.ai_provider_credentials for select to authenticated
  using (
    organization_id in (select public.fn_user_org_ids())
    or public.fn_is_platform_admin()
  );

notify pgrst, 'reload schema';
