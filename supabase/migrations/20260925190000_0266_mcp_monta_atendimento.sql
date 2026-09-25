-- 0266: montagem do atendimento pelo MCP, sempre em rascunho.

alter table public.ai_agent_versions
  add column if not exists skill_names text[],
  add column if not exists channel_config jsonb,
  add column if not exists mcp_api_token_id uuid,
  add column if not exists mcp_change_summary jsonb not null default '[]'::jsonb;

alter table public.ai_agent_versions
  drop constraint if exists ai_agent_versions_channel_config_object;
alter table public.ai_agent_versions
  add constraint ai_agent_versions_channel_config_object
  check (channel_config is null or jsonb_typeof(channel_config) = 'object');

alter table public.ai_agent_versions
  drop constraint if exists ai_agent_versions_mcp_change_summary_array;
alter table public.ai_agent_versions
  add constraint ai_agent_versions_mcp_change_summary_array
  check (jsonb_typeof(mcp_change_summary) = 'array');

create unique index if not exists api_tokens_organization_id_id_uidx
  on public.api_tokens(organization_id, id);

do $fk$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'ai_agent_versions_mcp_token_org_fk'
       and conrelid = 'public.ai_agent_versions'::regclass
  ) then
    alter table public.ai_agent_versions
      add constraint ai_agent_versions_mcp_token_org_fk
      foreign key (organization_id, mcp_api_token_id)
      references public.api_tokens(organization_id, id)
      on delete no action;
  end if;
end
$fk$;

create index if not exists ai_agent_versions_mcp_token_idx
  on public.ai_agent_versions(organization_id, mcp_api_token_id)
  where mcp_api_token_id is not null;

-- NULL mantém a semântica histórica para versões criadas por clientes que
-- ainda não conhecem este campo: todas as skills publicadas da organização.
-- Array, inclusive vazio, é uma escolha explícita da versão.
alter table public.ai_agent_versions
  alter column skill_names drop default,
  alter column skill_names drop not null;

alter table public.ai_agent_versions
  drop constraint if exists ai_agent_versions_provisioning_origin_check;
alter table public.ai_agent_versions
  add constraint ai_agent_versions_provisioning_origin_check
  check (provisioning_origin in ('onboarding', 'legacy_reconciliation', 'mcp'));

-- As novas escolhas também são conteúdo versionado. Depois de publicada, a
-- única forma de mudá-las é criar outro rascunho e publicar pela tela.
create or replace function public.fn_ai_agent_version_content_immutable() returns trigger
language plpgsql as $fn$
begin
  if old.status <> 'draft' and (
       new.system_prompt          is distinct from old.system_prompt
    or new.provider               is distinct from old.provider
    or new.model                  is distinct from old.model
    or new.credential_id          is distinct from old.credential_id
    or new.tool_ids               is distinct from old.tool_ids
    or new.trigger_config         is distinct from old.trigger_config
    or new.channel_session_id     is distinct from old.channel_session_id
    or new.max_steps              is distinct from old.max_steps
    or new.token_budget           is distinct from old.token_budget
    or new.cost_budget_cents      is distinct from old.cost_budget_cents
    or new.history_message_window is distinct from old.history_message_window
    or new.history_token_window   is distinct from old.history_token_window
    or new.handoff_keywords       is distinct from old.handoff_keywords
    or new.handoff_tool_enabled   is distinct from old.handoff_tool_enabled
    or new.followup               is distinct from old.followup
    or new.multimodal_input       is distinct from old.multimodal_input
    or new.video_frames_enabled   is distinct from old.video_frames_enabled
    or new.split_messages         is distinct from old.split_messages
    or new.split_max_chars        is distinct from old.split_max_chars
    or new.cases_enabled          is distinct from old.cases_enabled
    or new.operator_enabled       is distinct from old.operator_enabled
    or new.operator_model         is distinct from old.operator_model
    or new.operator_tool_ids      is distinct from old.operator_tool_ids
    or new.pipeline_ids           is distinct from old.pipeline_ids
    or new.knowledge_source_ids   is distinct from old.knowledge_source_ids
    or new.skill_names            is distinct from old.skill_names
    or new.channel_config         is distinct from old.channel_config
    or new.mcp_api_token_id       is distinct from old.mcp_api_token_id
    or new.mcp_change_summary     is distinct from old.mcp_change_summary
    or new.version_number         is distinct from old.version_number
    or new.agent_id               is distinct from old.agent_id
    or new.organization_id        is distinct from old.organization_id
  ) then
    raise exception 'ai_agent_versions % é imutável (status=%): mudança de conteúdo = versão draft nova; rollback = revert (clona + publica)',
      old.id, old.status;
  end if;
  return new;
end;
$fn$;

revoke execute on function public.fn_ai_agent_version_content_immutable()
  from public, anon, authenticated;

-- O canal só recebe a proposta quando uma pessoa publica o rascunho. O trigger
-- roda na mesma transação da publicação: falha aqui também desfaz o publish.
create or replace function public.fn_apply_agent_channel_config_on_publish() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare
  c jsonb := new.channel_config;
begin
  if new.status = 'published'
     and old.status is distinct from new.status
     and c is not null then
    if c ? 'max_concurrent_ai_conversations' then
      update public.channel_sessions
         set max_concurrent_ai_conversations = (c->>'max_concurrent_ai_conversations')::smallint,
             updated_at = now()
       where id = new.channel_session_id
         and organization_id = new.organization_id
         and archived_at is null;
      if not found then
        raise exception 'channel_session_not_found' using errcode = 'P0001';
      end if;
    end if;

    if c ?| array[
      'throttle_ms', 'jitter_max_ms', 'window_start_hour',
      'window_end_hour', 'allow_sunday', 'timezone'
    ] then
      insert into public.channel_knobs (
        organization_id, channel_session_id, throttle_ms, jitter_max_ms,
        window_start_hour, window_end_hour, allow_sunday, timezone
      ) values (
        new.organization_id,
        new.channel_session_id,
        case when c ? 'throttle_ms' then (c->>'throttle_ms')::integer end,
        case when c ? 'jitter_max_ms' then (c->>'jitter_max_ms')::integer end,
        case when c ? 'window_start_hour' then (c->>'window_start_hour')::smallint end,
        case when c ? 'window_end_hour' then (c->>'window_end_hour')::smallint end,
        case when c ? 'allow_sunday' then (c->>'allow_sunday')::boolean end,
        case when c ? 'timezone' then c->>'timezone' end
      )
      on conflict (organization_id, channel_session_id) do update set
        throttle_ms = case when c ? 'throttle_ms' then excluded.throttle_ms else channel_knobs.throttle_ms end,
        jitter_max_ms = case when c ? 'jitter_max_ms' then excluded.jitter_max_ms else channel_knobs.jitter_max_ms end,
        window_start_hour = case when c ? 'window_start_hour' then excluded.window_start_hour else channel_knobs.window_start_hour end,
        window_end_hour = case when c ? 'window_end_hour' then excluded.window_end_hour else channel_knobs.window_end_hour end,
        allow_sunday = case when c ? 'allow_sunday' then excluded.allow_sunday else channel_knobs.allow_sunday end,
        timezone = case when c ? 'timezone' then excluded.timezone else channel_knobs.timezone end,
        updated_at = now();
    end if;
  end if;
  return new;
end;
$fn$;

revoke execute on function public.fn_apply_agent_channel_config_on_publish()
  from public, anon, authenticated;
grant execute on function public.fn_apply_agent_channel_config_on_publish()
  to service_role;

drop trigger if exists trg_apply_agent_channel_config_on_publish
  on public.ai_agent_versions;
create trigger trg_apply_agent_channel_config_on_publish
  after update of status on public.ai_agent_versions
  for each row execute function public.fn_apply_agent_channel_config_on_publish();
