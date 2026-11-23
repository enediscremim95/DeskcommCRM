-- A marca de 17/11 é o critério do backfill, juntamente com o fornecedor.
-- A classificação não consulta nem decifra o conteúdo das credenciais.
do $$
begin
  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'ai_provider_credentials'
       and column_name = 'origem'
  ) then
    alter table public.ai_provider_credentials
      add column origem text not null default 'propria'
      constraint ai_provider_credentials_origem_check
      check (origem in ('propria', 'compartilhada'));

    update public.ai_provider_credentials
       set origem = 'compartilhada'
     where provider = 'openrouter'
       and label = 'CRM V4 Flash lock 17-11';
  end if;
end;
$$;

comment on column public.ai_provider_credentials.origem is
  'Origem de cobrança. O backfill de 17/11 identifica a chave compartilhada pelo par fornecedor e rótulo.';

-- O ponteiro pertence ao mesmo objeto que o fornecedor e o modelo padrão.
-- Deixá-lo ausente preserva a seleção legada nas organizações já configuradas.
comment on column public.organizations.settings is
  'Configurações da organização. llm.credential_id é o UUID opcional da credencial padrão de IA da mesma organização.';

grant select (origem) on public.ai_provider_credentials to authenticated;

create or replace view public.ai_provider_credentials_safe
with (security_invoker = true) as
select id, organization_id, provider, label, api_key_last4, validated_at,
       validation_error, models_available, is_active, created_by, created_at,
       updated_at, origem
  from public.ai_provider_credentials;

notify pgrst, 'reload schema';
