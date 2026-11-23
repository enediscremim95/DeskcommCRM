-- Chaves cadastradas na tela exigem seleção explícita para uso em chat.
-- O default mantém a seleção histórica e os caminhos de provisionamento.
alter table public.ai_provider_credentials
  add column if not exists selecao_explicita boolean not null default false;
grant select (selecao_explicita) on public.ai_provider_credentials to authenticated;

-- Prévia e confirmação da troca de chave. O mesmo cálculo delimita o que a
-- tela exibe e o que a transação pode alterar. O registro TS fornece os
-- propósitos elegíveis; a RPC só é acessível pelo backend.
create or replace function public.fn_usar_credencial_ia_padrao(
  p_org_id uuid, p_actor_id uuid, p_credential_id uuid, p_purposes text[],
  p_request_id uuid, p_model_id text default null, p_revision text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_settings jsonb;
  v_llm jsonb;
  v_provider text;
  v_models_available text[];
  v_models jsonb;
  v_agents jsonb;
  v_bindings jsonb;
  v_retained jsonb;
  v_plan jsonb;
  v_revision text;
  v_agent jsonb;
  v_version public.ai_agent_versions%rowtype;
  v_published jsonb := '[]'::jsonb;
  v_details jsonb;
begin
  perform 1 from public.user_organizations
    where organization_id = p_org_id and user_id = p_actor_id
      and revoked_at is null and role in ('owner', 'admin')
    for share;
  if not found then raise exception 'forbidden'; end if;

  select settings into strict v_settings from public.organizations
    where id = p_org_id for no key update;
  v_llm := case when jsonb_typeof(v_settings->'llm') = 'object'
    then v_settings->'llm' else '{}'::jsonb end;

  -- Serializa com a publicação oficial e com a edição dos vínculos existentes.
  perform 1 from public.ai_agents where organization_id = p_org_id
    and archived_at is null order by id for no key update;
  perform 1 from public.ai_purpose_bindings where organization_id = p_org_id
    order by id for no key update;

  select provider, models_available into v_provider, v_models_available
    from public.ai_provider_credentials
    where id = p_credential_id and organization_id = p_org_id
      and origem = 'propria' and is_active and validated_at is not null
      and validation_error is null
    for share;
  if not found then raise exception 'credential_not_usable'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', model_id, 'name', display_name)
    order by display_name, model_id), '[]'::jsonb)
    into v_models
    from public.ai_models
    where provider = v_provider and model_id = any(v_models_available)
      and deprecated_at is null and supports_tools;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'name', a.name, 'version_id', v.id, 'version_number', v.version_number,
    'provider', v.provider, 'model', v.model, 'operator_model', v.operator_model
  ) order by a.id), '[]'::jsonb) into v_agents
    from public.ai_agents a join public.ai_agent_versions v
      on v.id = a.published_version_id and v.organization_id = a.organization_id
      and v.agent_id = a.id
    where a.organization_id = p_org_id and a.archived_at is null;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id, 'purpose', b.purpose, 'provider', b.provider, 'model', b.model_id,
    'is_enabled', b.is_enabled, 'has_custom_endpoint', b.base_url is not null,
    'updated_at', b.updated_at
  ) order by b.purpose) filter (where b.purpose = any(p_purposes)
    and left(b.purpose, 9) <> 'followup_'), '[]'::jsonb),
    coalesce(jsonb_agg(b.purpose order by b.purpose) filter (where
      not (b.purpose = any(p_purposes)) or left(b.purpose, 9) = 'followup_'), '[]'::jsonb)
    into v_bindings, v_retained
    from public.ai_purpose_bindings b where b.organization_id = p_org_id;

  v_plan := jsonb_build_object(
    'provider', v_provider, 'models', v_models, 'agents', v_agents,
    'bindings', v_bindings, 'retained', v_retained,
    'current_provider', v_llm->>'provider', 'current_model', v_llm->>'default_model'
  );
  v_revision := encode(sha256(convert_to(jsonb_build_array(
    p_org_id, p_credential_id, v_plan, v_llm->'credential_id', v_llm->'enabled_models'
  )::text, 'UTF8')), 'hex');

  if p_model_id is null and p_revision is null then
    return v_plan || jsonb_build_object('revision', v_revision);
  end if;
  if p_revision is distinct from v_revision then raise exception 'plan_changed'; end if;
  -- Trava a linha até a publicação para evitar depreciação simultânea.
  perform 1 from public.ai_models
    where provider = v_provider and model_id = p_model_id
      and model_id = any(v_models_available) and deprecated_at is null and supports_tools
    for share;
  if not found then raise exception 'model_not_found'; end if;

  for v_agent in select value from jsonb_array_elements(v_agents) loop
    select * into strict v_version from public.ai_agent_versions
      where id = (v_agent->>'version_id')::uuid and organization_id = p_org_id;
    v_version.id := gen_random_uuid();
    select coalesce(max(version_number), 0) + 1 into v_version.version_number
      from public.ai_agent_versions
      where organization_id = p_org_id and agent_id = v_version.agent_id;
    v_version.provider := v_provider;
    v_version.model := p_model_id;
    if v_version.operator_model is not null then v_version.operator_model := p_model_id; end if;
    v_version.credential_id := p_credential_id;
    v_version.status := 'draft';
    v_version.created_at := now();
    v_version.created_by := p_actor_id;
    v_version.published_at := null;
    v_version.superseded_at := null;
    v_version.provisioning_origin := null;
    v_version.mcp_api_token_id := null;
    v_version.mcp_change_summary := '[]'::jsonb;
    insert into public.ai_agent_versions select (v_version).*;
    perform public.fn_publish_ai_agent_version(p_org_id, v_version.agent_id, v_version.id);
    v_published := v_published || jsonb_build_array(jsonb_build_object(
      'agent_id', v_version.agent_id, 'version_id', v_version.id,
      'previous_version_id', v_agent->>'version_id'
    ));
  end loop;

  -- Volta ao endpoint do fornecedor. Preserva o estado ligado/desligado.
  update public.ai_purpose_bindings
    set provider = v_provider, model_id = p_model_id,
      credential_id = p_credential_id, base_url = null
    where organization_id = p_org_id and id in (
      select (value->>'id')::uuid from jsonb_array_elements(v_bindings)
    );

  -- Preserva os demais parâmetros, inclusive a flag de fallback e modelos
  -- usados por pontos que mantêm sua configuração explícita.
  if jsonb_typeof(v_llm->'enabled_models') = 'array'
    and v_llm->'enabled_models' <> '[]'::jsonb
    and not ((v_llm->'enabled_models') ? p_model_id) then
    v_llm := jsonb_set(v_llm, '{enabled_models}',
      (v_llm->'enabled_models') || to_jsonb(p_model_id));
  end if;
  update public.organizations set settings = jsonb_set(
    coalesce(v_settings, '{}'::jsonb), '{llm}', v_llm || jsonb_build_object(
      'provider', v_provider, 'default_model', p_model_id, 'credential_id', p_credential_id
    )
  ) where id = p_org_id;

  v_details := jsonb_build_object('provider', v_provider, 'model_id', p_model_id,
    'versions', v_published, 'bindings', v_bindings,
    'previous_default', jsonb_build_object('provider', v_llm->>'provider',
      'model', v_llm->>'default_model', 'credential_id', v_llm->>'credential_id'));
  -- O helper de auditoria da aplicação é best effort. Aqui os dois registros
  -- fazem parte da mesma transação que muda a cobrança.
  insert into public.api_audit_log (
    organization_id, actor_user_id, action, resource_type, resource_id, request_id,
    bypassed_rls, metadata
  ) values (p_org_id, p_actor_id, 'ai.default_credential_changed',
    'ai_provider_credential', p_credential_id, p_request_id, true, v_details);
  insert into public.event_log (organization_id, event_type, entity_kind, entity_id, payload)
    values (p_org_id, 'ai.default_credential_changed', 'ai_provider_credential',
      p_credential_id, v_details);
  return jsonb_build_object('applied', true);
end;
$$;

revoke execute on function public.fn_usar_credencial_ia_padrao(uuid, uuid, uuid, text[], uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.fn_usar_credencial_ia_padrao(uuid, uuid, uuid, text[], uuid, text, text)
  to service_role;

notify pgrst, 'reload schema';
