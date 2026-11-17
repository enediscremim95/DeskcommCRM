-- 0313: reserva durável por organização/telefone, antes de qualquer primeiro toque.
-- Sem backfill: só o cadastro manual novo grava a intenção. Nenhuma configuração muda.
create table if not exists public.capture_contact_claims (
 organization_id uuid not null references public.organizations(id) on delete cascade,
 phone_number text not null,
 event_id uuid not null references public.event_log(id) on delete cascade,
 contact_id uuid not null references public.contacts(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key (organization_id, phone_number)
);
alter table public.capture_contact_claims enable row level security;
drop policy if exists tenant_isolation_capture_contact_claims_all on public.capture_contact_claims;
create policy tenant_isolation_capture_contact_claims_all on public.capture_contact_claims
 using (organization_id in (select public.fn_user_org_ids()))
 with check (organization_id in (select public.fn_user_org_ids()));
revoke all on public.capture_contact_claims from anon, authenticated;
grant all on public.capture_contact_claims to service_role;

create or replace function public.fn_capture_contact_claim(
 p_org uuid, p_event uuid, p_contact uuid, p_phone text, p_variants text[]
) returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare e public.event_log; l public.crm_leads; claim public.capture_contact_claims;
 ids uuid[]; settings jsonb; local_hour int; local_day int;
begin
 select * into e from public.event_log where id=p_event and organization_id=p_org;
 if not found or e.entity_kind <> 'crm_lead' or e.event_type <> 'lead.created' then return false; end if;
 select * into l from public.crm_leads where id=e.entity_id and organization_id=p_org and contact_id=p_contact;
 if not found or l.status <> 'open' or
   (l.source <> 'webhook' and (l.source <> 'manual' or l.source_metadata->>'ai_starts_conversation' is distinct from 'true')) then return false; end if;
 if not exists (select 1 from public.contacts where id=p_contact and organization_id=p_org and phone_number=any(p_variants)) then return false; end if;
 if regexp_replace(p_phone,'[^0-9]','','g') ~ '(997153441|97153441)$' then return false; end if;
 select o.settings->'capture_proactivity' into settings from public.organizations o where id=p_org;
 if settings->>'enabled' is distinct from 'true' then return false; end if;
 local_hour := extract(hour from now() at time zone coalesce(settings->>'timezone','America/Sao_Paulo'));
 local_day := extract(isodow from now() at time zone coalesce(settings->>'timezone','America/Sao_Paulo'));
 if local_day > 5 or local_hour < coalesce((settings->>'start_hour')::int,9) or local_hour >= coalesce((settings->>'end_hour')::int,18) then return false; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_org::text||':'||p_phone,0));
 select array_agg(id) into ids from public.contacts where organization_id=p_org and phone_number=any(p_variants);
 if exists (select 1 from public.contacts where organization_id=p_org and id=any(ids)
   and (is_blocked or is_anonymized or force_human or consent#>>'{marketing,declined_at}' is not null or tags && array['nao_contatar','sem_followup'])) then return false; end if;
 select * into claim from public.capture_contact_claims where organization_id=p_org and phone_number=p_phone;
 if found and claim.event_id<>p_event then return false; end if;
 -- O atendimento criado pelo próprio evento não bloqueia suas retomadas. Qualquer
 -- mensagem externa ou conversa anterior ativa/recente bloqueia, inclusive aliases.
 if exists (select 1 from public.conversations cv where cv.organization_id=p_org and cv.contact_id=any(ids)
   and (cv.last_inbound_at is not null or
     ((claim.event_id is null or cv.created_at < claim.created_at) and
       (cv.status not in ('resolved','closed','archived') or cv.last_message_at >= now()-interval '72 hours')))) then return false; end if;
 if exists (select 1 from public.messages m where m.organization_id=p_org and m.contact_id=any(ids)
   and m.metadata->>'capture_event_id' is distinct from p_event::text
   and (m.direction='inbound' or m.created_at >= now()-interval '72 hours')) then return false; end if;
 insert into public.capture_contact_claims(organization_id,phone_number,event_id,contact_id)
 values(p_org,p_phone,p_event,p_contact) on conflict do nothing;
 return true;
end $$;
revoke execute on function public.fn_capture_contact_claim(uuid,uuid,uuid,text,text[]) from public, anon, authenticated;
grant execute on function public.fn_capture_contact_claim(uuid,uuid,uuid,text,text[]) to service_role;

-- A redação LGPD continua alcançando toda informação de contato.
CREATE OR REPLACE FUNCTION "public"."fn_lgpd_cascade_redact_contact"("p_organization_id" "uuid", "p_contact_id" "uuid", "p_request_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_already bool;
  v_counts jsonb := '{}'::jsonb;
  v_media_paths text[] := '{}';
  v_anon_label text;
  v_count int;
begin
  perform public.fn_service_lock(p_organization_id,p_contact_id);
  select is_anonymized into v_already
    from contacts
    where id = p_contact_id and organization_id = p_organization_id;

  if not found then
    raise exception 'contact not found' using errcode = 'P0002';
  end if;

  if v_already then
    return jsonb_build_object('already_anonymized', true, 'counts', v_counts, 'media_paths', v_media_paths);
  end if;

  v_anon_label := 'Cliente Anonimizado #' || substring(p_contact_id::text from 1 for 8);

  -- Collect media storage paths (we only delete what we own — media_storage_path)
  select coalesce(array_agg(distinct media_storage_path) filter (where media_storage_path is not null), '{}')
    into v_media_paths
    from messages
    where organization_id = p_organization_id
      and conversation_id in (
        select id from conversations
          where contact_id = p_contact_id and organization_id = p_organization_id
      );

  -- 0313: a reserva guarda telefone e também participa da redação.
  delete from public.capture_contact_claims
    where organization_id = p_organization_id and contact_id = p_contact_id;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('capture_contact_claims', v_count);

  -- 1. contacts (irreversible)
  update contacts set
    name = v_anon_label,
    display_name = v_anon_label,
    email = null,
    -- email_normalized NÃO entra: é GENERATED ALWAYS AS (lower(trim(email)))
    -- e o Postgres recusa escrita nela — a linha acima já a zera por derivação.
    -- Com a atribuição, o cascade INTEIRO abortava e nada era anonimizado.
    phone_number = null,
    cpf_encrypted = null,
    cpf_hash = null,
    birthdate = null,
    is_anonymized = true,
    anonymized_at = now(),
    consent = '{}'::jsonb,
    source_metadata = '{}'::jsonb,
    tags = '{}'::text[],
    updated_at = now()
  where id = p_contact_id and organization_id = p_organization_id;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('contacts', v_count);

  -- 2. conversations metadata + preview strip
  update conversations set
    metadata = '{}'::jsonb,
    last_message_preview = null,
    updated_at = now()
  where contact_id = p_contact_id and organization_id = p_organization_id;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('conversations', v_count);

  -- 3. messages: redact body + null media + strip metadata (preserve status/timestamps/conversation_id)
  update messages set
    body = '[mensagem anonimizada]',
    media_url = null,
    media_mime = null,
    media_size_bytes = null,
    media_storage_path = null,
    metadata = '{}'::jsonb,
    updated_at = now()
  where organization_id = p_organization_id
    and conversation_id in (
      select id from conversations
        where contact_id = p_contact_id and organization_id = p_organization_id
    );
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('messages', v_count);

  -- 4. crm_lead_activities — strip payload, metadata E reason (migration 0071).
  --    `reason` é texto livre escrito por LLM sobre a conversa do lead: supor que
  --    nunca conterá um nome é a suposição que falha. `evidence` NÃO é limpa —
  --    guarda só ids, e as linhas apontadas são redigidas por conta própria.
  update crm_lead_activities set
    payload = '{}'::jsonb,
    metadata = '{}'::jsonb,
    reason = null
  where organization_id = p_organization_id
    and (
      contact_id = p_contact_id
      or lead_id in (
        select lead_id from crm_lead_links
          where target_kind = 'contact'
            and target_id = p_contact_id
            and organization_id = p_organization_id
      )
      or lead_id in (
        select id from crm_leads
          where contact_id = p_contact_id and organization_id = p_organization_id
      )
    );
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('activities', v_count);

  -- 5. crm_leads — strip title/description/custom_fields/source_metadata/tags but PRESERVE pipeline/stage/value
  update crm_leads set
    title = v_anon_label,
    description = null,
    custom_fields = '{}'::jsonb,
    source_metadata = '{}'::jsonb,
    tags = '{}'::text[],
    updated_at = now()
  where organization_id = p_organization_id
    and (
      contact_id = p_contact_id
      or id in (
        select lead_id from crm_lead_links
          where target_kind = 'contact'
            and target_id = p_contact_id
            and organization_id = p_organization_id
      )
    );
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('leads', v_count);

  -- 6. orders — PRESERVE values + status + timestamps. Strip personal fields from payload jsonb
  --    and replace customer_external_id with null (FK-safe; soft de-link). Keep contact_id null.
  update orders set
    payload = (coalesce(payload, '{}'::jsonb))
      - 'customer'
      - 'customer_name'
      - 'customer_email'
      - 'customer_phone'
      - 'shipping_address'
      - 'billing_address'
      - 'contact_identification',
    customer_external_id = null,
    contact_id = null,
    is_anonymized = true,
    updated_at = now()
  where organization_id = p_organization_id
    and contact_id = p_contact_id;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('orders', v_count);

  -- 7. enqueue media for async deletion (idempotent via unique (bucket, object_path))
  if array_length(v_media_paths, 1) > 0 then
    insert into storage_redaction_queue (organization_id, request_id, bucket, object_path)
    select p_organization_id, p_request_id, 'whatsapp-media', path
      from unnest(v_media_paths) as path
      where path is not null and length(path) > 0
    on conflict (bucket, object_path) do nothing;
  end if;

  -- 7b. voice_calls — o TELEFONE de quem falou ao telefone (migration 0235).
  --
  -- `peer_phone` é `not null` e guarda o número da outra ponta: depois de
  -- anonimizar o contato, ele sobrevivia ligado ao `contact_id` e reidentificava
  -- a pessoa que pediu para ser esquecida. É o mesmo argumento que a foto de
  -- perfil já tinha (ver o bloco do avatar em `lib/lgpd/redact-cascade.ts`):
  -- anonimizar em toda parte menos numa é não ter anonimizado.
  --
  -- O que fica: direção, status, motivo do fim, marcas de tempo e duração. Um
  -- registro de "houve uma chamada de 12 minutos" sem número e sem dono não
  -- identifica ninguém e é o que sustenta a métrica do atendente e a fatura.
  -- `peer_phone` é NOT NULL, então recebe o rótulo, não `null`.
  update voice_calls set
    peer_phone = v_anon_label,
    owner_user_id = null,
    created_by = null,
    updated_at = now()
  where organization_id = p_organization_id
    and contact_id = p_contact_id;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('voice_calls', v_count);

  -- 8. dense audit row
  insert into api_audit_log (organization_id, action, actor_user_id, resource_type, resource_id, metadata, bypassed_rls)
  values (
    p_organization_id,
    'lgpd.redact_executed',
    null,
    'contact',
    p_contact_id,
    jsonb_build_object(
      'cascaded_to', v_counts,
      'media_queued', coalesce(array_length(v_media_paths, 1), 0),
      'request_id', p_request_id
    ),
    true
  );

  return jsonb_build_object(
    'already_anonymized', false,
    'counts', v_counts,
    'media_paths', v_media_paths
  );
end;
$$;
revoke all on function public.fn_lgpd_cascade_redact_contact(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.fn_lgpd_cascade_redact_contact(uuid,uuid,uuid) to service_role;
