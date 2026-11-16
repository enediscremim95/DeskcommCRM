-- 0298: imagem e video em respostas rapidas, mais imagens persistentes do catalogo.
--
-- message_templates continua aceitando o audio legado. A nova midia e um unico
-- anexo de imagem ou video, e a constraint impede dois anexos no mesmo atalho.
alter table public.message_templates
  add column if not exists media_storage_path text,
  add column if not exists media_mime_type text,
  add column if not exists media_file_name text,
  add column if not exists media_size_bytes bigint,
  add column if not exists media_kind text;

do $$ begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'message_templates_media_complete'
       and conrelid = 'public.message_templates'::regclass
  ) then
    alter table public.message_templates
      add constraint message_templates_media_complete check (
        (
          media_storage_path is null
          and media_mime_type is null
          and media_file_name is null
          and media_size_bytes is null
          and media_kind is null
        )
        or
        (
          media_storage_path is not null
          and media_mime_type is not null
          and media_file_name is not null
          and media_size_bytes > 0
          and media_kind in ('image', 'video')
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'message_templates_one_attachment'
       and conrelid = 'public.message_templates'::regclass
  ) then
    alter table public.message_templates
      add constraint message_templates_one_attachment check (
        not (audio_storage_path is not null and media_storage_path is not null)
      );
  end if;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'catalog-media',
  'catalog-media',
  true,
  5242880,
  array['image/jpeg', 'image/png']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Troca ou remocao de qualquer anexo do atalho entra na fila ja consumida pelo
-- worker. O trigger nao toca no Storage dentro da transacao.
create or replace function public.fn_enqueue_message_template_audio_cleanup()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if tg_op = 'DELETE' then
    insert into public.storage_redaction_queue (
      organization_id, request_id, bucket, object_path, status, attempts,
      error_message, processed_at
    )
    select
      old.organization_id, null, 'whatsapp-media', caminho,
      'pending', 0, null, null
    from unnest(array[old.audio_storage_path, old.media_storage_path]) caminho
    where caminho is not null
    on conflict (bucket, object_path) do update set
      organization_id = excluded.organization_id,
      request_id = null,
      status = 'pending',
      attempts = 0,
      error_message = null,
      processed_at = null,
      enqueued_at = now();
  else
    insert into public.storage_redaction_queue (
      organization_id, request_id, bucket, object_path, status, attempts,
      error_message, processed_at
    )
    select
      old.organization_id, null, 'whatsapp-media', caminho,
      'pending', 0, null, null
    from (
      values
        (
          old.audio_storage_path,
          old.audio_storage_path is distinct from new.audio_storage_path
        ),
        (
          old.media_storage_path,
          old.media_storage_path is distinct from new.media_storage_path
        )
    ) as removida(caminho, mudou)
    where caminho is not null and mudou
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
  before update of audio_storage_path, media_storage_path or delete
  on public.message_templates
  for each row execute function public.fn_enqueue_message_template_audio_cleanup();

comment on column public.message_templates.media_storage_path is
  'Imagem ou video privado da resposta rapida; remocoes entram em storage_redaction_queue.';
comment on column public.message_templates.media_kind is
  'Tipo provider-agnostic do anexo da resposta rapida: image ou video.';

