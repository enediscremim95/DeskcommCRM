-- 0278: medição exata do bucket de mídia e índice do expurgo por idade.
--
-- O teto é da INSTALAÇÃO porque o disco é compartilhado. Somar só
-- `messages.media_size_bytes` deixaria órfãos e avatares invisíveis; o bucket
-- real é a fonte. O maior entre bucket e mensagens evita subcontar um Storage
-- cujo metadata antigo não tenha `size`.

create index if not exists idx_messages_media_retention
  on public.messages (sent_at, id)
  where media_storage_path is not null;

create or replace function public.fn_total_midia_armazenada_bytes()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
    coalesce((
      select sum(
        case
          when o.metadata->>'size' ~ '^[0-9]+$' then (o.metadata->>'size')::bigint
          else 0
        end
      )::bigint
      from storage.objects o
      where o.bucket_id = 'whatsapp-media'
    ), 0::bigint),
    coalesce((
      select sum(m.media_size_bytes)::bigint
      from public.messages m
      where m.media_storage_path is not null
    ), 0::bigint)
  );
$$;

revoke execute on function public.fn_total_midia_armazenada_bytes() from public, anon, authenticated;
grant execute on function public.fn_total_midia_armazenada_bytes() to service_role;

comment on function public.fn_total_midia_armazenada_bytes() is
  'Bytes ocupados pela mídia do WhatsApp na instalação. Só service_role; alimenta o teto e a vigia.';

notify pgrst, 'reload schema';
