-- 0303: fim de expediente específico do sábado por canal.
--
-- NULL preserva o comportamento anterior: sábado usa window_end_hour.
-- Valor menor ou igual a window_start_hour é válido e representa sábado fechado.

alter table public.channel_knobs
  add column if not exists window_saturday_end_hour smallint;

do $constraint$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'channel_knobs_window_saturday_end_hour_check'
      and conrelid = 'public.channel_knobs'::regclass
  ) then
    alter table public.channel_knobs
      add constraint channel_knobs_window_saturday_end_hour_check
      check (window_saturday_end_hour between 0 and 24);
  end if;
end
$constraint$;

comment on column public.channel_knobs.window_saturday_end_hour is
  'Fim exclusivo da janela de sábado; NULL herda window_end_hour e valor menor ou igual ao início fecha o sábado.';

-- A publicação humana da configuração versionada do agente precisa aplicar o
-- mesmo campo que a tela de Conexões. Recriar a função não abre privilégio.
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
      'window_end_hour', 'window_saturday_end_hour', 'allow_sunday', 'timezone'
    ] then
      insert into public.channel_knobs (
        organization_id, channel_session_id, throttle_ms, jitter_max_ms,
        window_start_hour, window_end_hour, window_saturday_end_hour,
        allow_sunday, timezone
      ) values (
        new.organization_id,
        new.channel_session_id,
        case when c ? 'throttle_ms' then (c->>'throttle_ms')::integer end,
        case when c ? 'jitter_max_ms' then (c->>'jitter_max_ms')::integer end,
        case when c ? 'window_start_hour' then (c->>'window_start_hour')::smallint end,
        case when c ? 'window_end_hour' then (c->>'window_end_hour')::smallint end,
        case when c ? 'window_saturday_end_hour' then (c->>'window_saturday_end_hour')::smallint end,
        case when c ? 'allow_sunday' then (c->>'allow_sunday')::boolean end,
        case when c ? 'timezone' then c->>'timezone' end
      )
      on conflict (organization_id, channel_session_id) do update set
        throttle_ms = case when c ? 'throttle_ms' then excluded.throttle_ms else channel_knobs.throttle_ms end,
        jitter_max_ms = case when c ? 'jitter_max_ms' then excluded.jitter_max_ms else channel_knobs.jitter_max_ms end,
        window_start_hour = case when c ? 'window_start_hour' then excluded.window_start_hour else channel_knobs.window_start_hour end,
        window_end_hour = case when c ? 'window_end_hour' then excluded.window_end_hour else channel_knobs.window_end_hour end,
        window_saturday_end_hour = case when c ? 'window_saturday_end_hour' then excluded.window_saturday_end_hour else channel_knobs.window_saturday_end_hour end,
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

notify pgrst, 'reload schema';

