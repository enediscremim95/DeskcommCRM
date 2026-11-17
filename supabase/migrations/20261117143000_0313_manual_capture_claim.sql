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
