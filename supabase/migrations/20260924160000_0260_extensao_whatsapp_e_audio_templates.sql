-- 0260: áudio em respostas rápidas e sessão efêmera da extensão de apoio.
--
-- A extensão nunca recebe a sessão ampla do CRM. O navegador do CRM emite um
-- pareamento curto; a extensão guarda apenas o token mínimo em storage.session.
-- Toda operação exige presença recente de uma aba autenticada do CRM.

alter table public.message_templates
  add column if not exists audio_storage_path text,
  add column if not exists audio_mime_type text,
  add column if not exists audio_file_name text,
  add column if not exists audio_size_bytes bigint;

update storage.buckets
   set public = false
 where id = 'whatsapp-media';

do $$ begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'message_templates_audio_complete'
       and conrelid = 'public.message_templates'::regclass
  ) then
    alter table public.message_templates
      add constraint message_templates_audio_complete check (
        (audio_storage_path is null and audio_mime_type is null and audio_file_name is null and audio_size_bytes is null)
        or
        (audio_storage_path is not null and audio_mime_type = 'audio/ogg; codecs=opus'
          and audio_file_name is not null and audio_size_bytes > 0)
      );
  end if;
end $$;

create table if not exists public.browser_extension_pairings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  crm_origin text not null,
  extension_id text not null,
  pairing_code_hash text not null unique,
  pairing_code_expires_at timestamptz not null,
  access_token_hash text unique,
  paired_at timestamptz,
  last_seen_at timestamptz,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint browser_extension_pairings_origin_https check (
    crm_origin ~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?$'
    or crm_origin ~ '^http://(localhost|127\\.0\\.0\\.1)(:[0-9]+)?$'
  )
);

create index if not exists browser_extension_pairings_alive_idx
  on public.browser_extension_pairings (access_token_hash, expires_at)
  where access_token_hash is not null and revoked_at is null;
create index if not exists browser_extension_pairings_user_idx
  on public.browser_extension_pairings (organization_id, user_id, created_at desc);

alter table public.browser_extension_pairings enable row level security;
drop policy if exists tenant_isolation_browser_extension_pairings_all
  on public.browser_extension_pairings;
create policy tenant_isolation_browser_extension_pairings_all
  on public.browser_extension_pairings for all
  using (organization_id in (select public.fn_user_org_ids()))
  with check (organization_id in (select public.fn_user_org_ids()));
revoke all on public.browser_extension_pairings from anon, authenticated;
grant all on public.browser_extension_pairings to service_role;

-- Toda troca/remoção de áudio entra na mesma fila de expurgo das demais
-- mídias. O trigger só grava no banco; o worker continua dono do Storage.
create or replace function public.fn_enqueue_message_template_audio_cleanup()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if old.audio_storage_path is not null
     and tg_op = 'DELETE' then
    insert into public.storage_redaction_queue (
      organization_id, request_id, bucket, object_path, status, attempts,
      error_message, processed_at
    ) values (
      old.organization_id, null, 'whatsapp-media', old.audio_storage_path,
      'pending', 0, null, null
    )
    on conflict (bucket, object_path) do update set
      organization_id = excluded.organization_id,
      request_id = null,
      status = 'pending',
      attempts = 0,
      error_message = null,
      processed_at = null,
      enqueued_at = now();
  elsif old.audio_storage_path is not null
        and new.audio_storage_path is distinct from old.audio_storage_path then
    insert into public.storage_redaction_queue (
      organization_id, request_id, bucket, object_path, status, attempts,
      error_message, processed_at
    ) values (
      old.organization_id, null, 'whatsapp-media', old.audio_storage_path,
      'pending', 0, null, null
    )
    on conflict (bucket, object_path) do update set
      organization_id = excluded.organization_id,
      request_id = null,
      status = 'pending',
      attempts = 0,
      error_message = null,
      processed_at = null,
      enqueued_at = now();
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke execute on function public.fn_enqueue_message_template_audio_cleanup()
  from public, anon, authenticated;

drop trigger if exists trg_message_template_audio_cleanup on public.message_templates;
create trigger trg_message_template_audio_cleanup
  before update of audio_storage_path or delete on public.message_templates
  for each row execute function public.fn_enqueue_message_template_audio_cleanup();

comment on table public.browser_extension_pairings is
  'Pareamento efêmero e de escopo mínimo da extensão de apoio humano no WhatsApp Web.';
comment on column public.message_templates.audio_storage_path is
  'Áudio OGG/Opus privado da resposta rápida; remoções entram em storage_redaction_queue.';
