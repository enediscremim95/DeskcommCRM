-- 0308: o agendamento continua com sala Jitsi quando o Google não está utilizável.
-- Forward-fix idempotente. Não altera migrations já aplicadas nem dados históricos.

create or replace function public.fn_meet_stamp()
returns trigger language plpgsql set search_path=public as $$
declare redacted boolean; j public.job_queue; b jsonb; valid_jitsi boolean; valid_ready boolean;
begin
 valid_jitsi:=new.meeting_url ~ '^https://meet[.]jit[.]si/[A-Za-z0-9_-]+/?$' and new.location_kind in ('google_meet','video_link');
 valid_ready:=new.meeting_state='ready' and new.meeting_request_id is not null and
  (valid_jitsi or (new.location_kind='google_meet' and new.meeting_url ~ '^https://meet[.]google[.]com/[A-Za-z0-9-]+/?$'));
 if current_user in ('authenticated','anon') then
  if tg_op='INSERT' then
   if (new.meeting_delivery<>'{"state":"none"}'::jsonb or new.meeting_request_id is not null or new.meeting_url is not null or new.meeting_state<>'not_requested' or new.meeting_requested_at is not null or new.meeting_received_at is not null or new.meeting_ready_at is not null or new.meeting_attempts<>0 or new.meeting_last_error is not null or new.meeting_next_attempt_at is not null or new.meeting_delivery_job_id is not null)
    and not (valid_jitsi and valid_ready and new.meeting_requested_at is null and new.meeting_received_at is null and new.meeting_attempts=0 and new.meeting_last_error is null and new.meeting_next_attempt_at is null and new.meeting_delivery_job_id is null)
   then raise exception 'meet_metadata_private' using errcode='42501';end if;
  elsif row(new.meeting_state,new.meeting_request_id,new.meeting_requested_at,new.meeting_received_at,new.meeting_ready_at,new.meeting_attempts,new.meeting_last_error,new.meeting_next_attempt_at,new.meeting_delivery,new.meeting_delivery_job_id,new.meeting_url)
   is distinct from row(old.meeting_state,old.meeting_request_id,old.meeting_requested_at,old.meeting_received_at,old.meeting_ready_at,old.meeting_attempts,old.meeting_last_error,old.meeting_next_attempt_at,old.meeting_delivery,old.meeting_delivery_job_id,old.meeting_url) then
   raise exception 'meet_metadata_private' using errcode='42501';
  end if;
 end if;
 select is_anonymized into redacted from public.contacts where id=new.contact_id and organization_id=new.organization_id;
 if new.meeting_state='ready' and not valid_ready then raise exception 'meet_invalid_url' using errcode='22023';end if;
 if (redacted or new.status='cancelled' or new.location_kind not in ('google_meet','video_link') or (new.location_kind='video_link' and coalesce(new.location_details,'')<>'' and new.meeting_state<>'ready'))
  and (new.location_kind in ('google_meet','video_link') or new.meeting_state<>'not_requested') then
  if new.location_kind in ('google_meet','video_link') or new.meeting_state<>'not_requested' or new.meeting_requested_at is not null or new.meeting_received_at is not null or new.meeting_ready_at is not null or new.meeting_attempts<>0 or new.meeting_last_error is not null or new.meeting_next_attempt_at is not null or new.meeting_delivery_job_id is not null then new.meeting_state:='cancelled';end if;
  new.meeting_request_id:=null;new.meeting_url:=null;new.meeting_last_error:=null;new.meeting_next_attempt_at:=null;
  new.meeting_delivery:=jsonb_build_object('state',case when redacted then 'blocked' else 'stale' end);
 elsif new.location_kind='google_meet' and new.meeting_state='not_requested' then
  new.meeting_state:='pending';new.meeting_request_id:=gen_random_uuid();new.meeting_next_attempt_at:=now();
 end if;
 if tg_op='INSERT' and new.meeting_delivery ? 'booking_claim' then
  perform public.fn_service_lock(new.organization_id,new.contact_id);
  select * into j from public.job_queue where organization_id=new.organization_id and id=(new.meeting_delivery->>'source_operation_id')::uuid for update;
  b:=new.meeting_delivery->'service_boundary';
  if j.contact_id is distinct from new.contact_id or j.status is distinct from 'running' or j.kind not in ('inbound_turn','followup_turn','case_reply_turn','operator_turn')
   or j.locked_by is distinct from new.meeting_delivery->'booking_claim'->>'worker_id' or j.locked_at is distinct from (new.meeting_delivery->'booking_claim'->>'acquired_at')::timestamptz
   or j.payload->'service_boundary' is distinct from b or not public.fn_meet_boundary_current(b) or b->>'conversation_id' is distinct from new.conversation_id::text then
   raise exception 'meet_booking_stale' using errcode='40001';end if;
  if new.meeting_delivery->'authorized_by'->>'kind' is distinct from 'ai_agent' then raise exception 'meet_booking_origin_invalid' using errcode='42501';end if;
  new.meeting_delivery:=new.meeting_delivery-'booking_claim';
 end if;
 if new.meeting_delivery ? 'generation' and (tg_op='INSERT' or new.meeting_delivery->>'generation' is distinct from old.meeting_delivery->>'generation') then
  new.meeting_delivery:=new.meeting_delivery||jsonb_build_object('channel_session_id',(select channel_session_id from public.conversations where organization_id=new.organization_id and contact_id=new.contact_id and id::text=new.meeting_delivery->'service_boundary'->>'conversation_id'));
 end if;
 if new.meeting_state='pending' and new.meeting_next_attempt_at is not null then new.google_next_attempt_at:=least(new.google_next_attempt_at,new.meeting_next_attempt_at);end if;
 return new;
end;$$;
revoke all on function public.fn_meet_stamp() from public,anon,authenticated;

create or replace function public.fn_meet_delivery_current(p_org uuid,p_job uuid,p_worker text,p_acquired_at timestamptz)
returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.job_queue j join public.calendar_appointments a on a.organization_id=j.organization_id and a.id::text=j.payload->>'appointment_id'
  join public.contacts c on c.organization_id=a.organization_id and c.id=a.contact_id
  join public.conversations v on v.organization_id=a.organization_id and v.contact_id=a.contact_id and v.id::text=j.payload->'service_boundary'->>'conversation_id'
  join public.channel_sessions cs on cs.organization_id=v.organization_id and cs.id=v.channel_session_id
  join public.organizations o on o.id=a.organization_id and o.status='active'
  where cs.archived_at is null and a.meeting_delivery->>'channel_session_id'=cs.id::text and j.organization_id=p_org and j.id=p_job and j.kind='transactional_delivery' and j.status='running' and j.locked_by=p_worker and j.locked_at=p_acquired_at
   and a.contact_id=j.contact_id and not c.is_anonymized and not c.is_blocked and a.status<>'cancelled' and a.meeting_state='ready'
   and (a.meeting_url ~ '^https://meet[.]google[.]com/[A-Za-z0-9-]+/?$' or a.meeting_url ~ '^https://meet[.]jit[.]si/[A-Za-z0-9_-]+/?$')
   and a.meeting_request_id::text=j.payload->>'meeting_request_id' and a.meeting_delivery->>'generation'=j.payload->>'delivery_generation'
   and a.meeting_delivery_job_id=j.id and a.meeting_delivery->>'state'='queued'
   and exists(select 1 from public.user_organizations where organization_id=p_org and user_id=a.owner_user_id and revoked_at is null)
   and (a.meeting_delivery->'authorized_by'->>'kind'='ai_agent' or
    (a.meeting_delivery->'authorized_by'->>'kind'='user' and a.meeting_delivery->'authorized_by'->>'id'=a.owner_user_id::text and exists(
     select 1 from public.user_organizations u where u.organization_id=p_org and u.user_id=a.owner_user_id and u.revoked_at is null and u.role in ('agent','manager','admin')
      and (u.role in ('manager','admin') or v.assigned_to_user_id=u.user_id or o.settings->>'visibility_mode'='all'
       or (coalesce(o.settings->>'visibility_mode','own_and_unassigned')='own_and_unassigned' and v.assigned_to_user_id is null)))))
   and a.meeting_delivery->'service_boundary'=j.payload->'service_boundary' and public.fn_meet_boundary_current(j.payload->'service_boundary'));
$$;
revoke all on function public.fn_meet_delivery_current(uuid,uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.fn_meet_delivery_current(uuid,uuid,text,timestamptz) to service_role;

create or replace function public.fn_meet_action(p_org uuid,p_id uuid,p_revision text,p_request uuid,p_action text,p_conversation uuid default null)
returns boolean language plpgsql security definer set search_path=public as $$
declare a public.calendar_appointments; contact uuid; b jsonb; destination_channel uuid;
begin
 if auth.uid() is null or not public.fn_role_at_least(p_org,'agent') or not public.fn_support_write_allowed(p_org) then raise exception 'meet_forbidden' using errcode='42501';end if;
 if not public.fn_session_mfa_proven() then raise exception 'meet_mfa_required' using errcode='42501';end if;
 select contact_id into contact from public.calendar_appointments where organization_id=p_org and id=p_id;
 if contact is not null then perform public.fn_service_lock(p_org,contact);end if;
 select * into a from public.calendar_appointments where organization_id=p_org and id=p_id for update;
 if not found or a.owner_user_id is distinct from auth.uid() or not exists(select 1 from public.user_organizations where organization_id=p_org and user_id=auth.uid() and revoked_at is null) then raise exception 'meet_forbidden' using errcode='42501';end if;
 if a.revision::text is distinct from p_revision or a.meeting_request_id is distinct from p_request or a.status='cancelled' or a.location_kind not in ('google_meet','video_link')
  or exists(select 1 from public.contacts where id=a.contact_id and organization_id=p_org and is_anonymized) then raise exception 'meet_stale' using errcode='40001';end if;
 if p_action='retry' then
  if a.location_kind<>'google_meet' then raise exception 'meet_action_invalid' using errcode='22023';end if;
  if a.google_conflict is not null then raise exception 'google_conflict_requires_choice' using errcode='40001';end if;
  if a.meeting_state='ready' then return false;end if;
  if a.meeting_state<>'failed' then
   update public.calendar_appointments set meeting_next_attempt_at=now(),google_next_attempt_at=now() where organization_id=p_org and id=p_id;return true;
  end if;
  update public.calendar_appointments set meeting_request_id=case when meeting_last_error='google_failure' and meeting_received_at is not null then gen_random_uuid() else meeting_request_id end,
   meeting_requested_at=case when meeting_last_error='google_failure' and meeting_received_at is not null then null else meeting_requested_at end,
   meeting_received_at=case when meeting_last_error='google_failure' then null else meeting_received_at end,
   meeting_state='pending',meeting_attempts=0,meeting_last_error=null,meeting_next_attempt_at=now(),google_next_attempt_at=now() where organization_id=p_org and id=p_id;
 elsif p_action='deliver' then
  if a.contact_id is null then raise exception 'meet_conversation_unavailable' using errcode='42501';end if;
  select channel_session_id into destination_channel from public.conversations where organization_id=p_org and id=p_conversation and contact_id=a.contact_id and not is_group and public.fn_can_view_conversation(organization_id,assigned_to_user_id) for update;
  if not found then raise exception 'meet_conversation_unavailable' using errcode='42501';end if;
  b:=public.fn_service_boundary(p_org,p_conversation)-'status'-'demanda_fechada_em'-'service_started_at';
  if not public.fn_meet_boundary_current(b) then raise exception 'meet_conversation_stale' using errcode='40001';end if;
  if a.meeting_delivery->'service_boundary'=b and a.meeting_delivery->>'channel_session_id'=destination_channel::text then
   if a.meeting_delivery->>'state' in ('waiting_for_link','sent') then return false;end if;
   if a.meeting_delivery->>'state'='queued' and a.meeting_delivery_job_id is not null then
    update public.job_queue set status='pending',locked_by=null,locked_at=null,attempts=0,run_after=now(),last_error=null
     where organization_id=p_org and id=a.meeting_delivery_job_id and kind='transactional_delivery' and status in ('dead','failed','done');
    return found;
   end if;
  end if;
  update public.job_queue set status='failed',locked_by=null,locked_at=null,last_error='meet_delivery_superseded' where organization_id=p_org and id=a.meeting_delivery_job_id and kind='transactional_delivery' and status in ('pending','running');
  update public.calendar_appointments set meeting_delivery=jsonb_build_object('state','waiting_for_link','generation',gen_random_uuid(),'service_boundary',b,'authorized_by',jsonb_build_object('kind','user','id',auth.uid()),'source_operation_id',gen_random_uuid()),meeting_delivery_job_id=null where organization_id=p_org and id=p_id;
 else raise exception 'meet_action_invalid' using errcode='22023';end if;
 return true;
end;$$;
revoke all on function public.fn_meet_action(uuid,uuid,text,uuid,text,uuid) from public,anon;
grant execute on function public.fn_meet_action(uuid,uuid,text,uuid,text,uuid) to authenticated;

create or replace function public.fn_appointment_fallback_jitsi(p_org uuid,p_id uuid,p_url text)
returns boolean language plpgsql security definer set search_path=public as $$
begin
 if p_url !~ '^https://meet[.]jit[.]si/[A-Za-z0-9_-]+/?$' then raise exception 'meet_invalid_url' using errcode='22023';end if;
 update public.calendar_appointments set meeting_state='ready',meeting_url=p_url,meeting_ready_at=now(),meeting_last_error=null,meeting_next_attempt_at=null
  where organization_id=p_org and id=p_id and location_kind='google_meet' and meeting_state in ('pending','failed');
 return found;
end;$$;
revoke all on function public.fn_appointment_fallback_jitsi(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.fn_appointment_fallback_jitsi(uuid,uuid,text) to service_role;

-- URLs de ambos os provedores continuam fora de snapshots e resultados derivados.
create or replace function public.fn_meet_minimize_runtime()
returns trigger language plpgsql set search_path=public as $$
begin
 new:=jsonb_populate_record(new,regexp_replace(to_jsonb(new)::text,'https://meet[.](google[.]com|jit[.]si)/[A-Za-z0-9_-]+',case when tg_table_name='outbound_copies' then '[meet-link]' else '[link da reunião disponível na Agenda]' end,'g')::jsonb);
 return new;
end;$$;
revoke all on function public.fn_meet_minimize_runtime() from public,anon,authenticated;

create unique index if not exists uniq_event_agenda_owner_ics
 on public.event_log(organization_id,event_type,entity_id)
 where event_type='agenda.owner_ics_invite';

create or replace function public.fn_agenda_owner_ics_enqueue()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.status<>'cancelled' and new.meeting_state='ready'
  and new.meeting_url ~ '^https://meet[.]jit[.]si/[A-Za-z0-9_-]+/?$'
  and (tg_op='INSERT' or old.meeting_state is distinct from 'ready' or old.meeting_url is distinct from new.meeting_url) then
  insert into public.event_log(organization_id,event_type,entity_kind,entity_id,payload,metadata)
  values(new.organization_id,'agenda.owner_ics_invite','calendar_appointment',new.id,'{}'::jsonb,jsonb_build_object('email_dedupe_key','agenda-owner-ics:'||new.id::text))
  on conflict(organization_id,event_type,entity_id) where event_type='agenda.owner_ics_invite' do nothing;
 end if;
 return new;
end;$$;
revoke all on function public.fn_agenda_owner_ics_enqueue() from public,anon,authenticated;
drop trigger if exists trg_agenda_owner_ics_enqueue on public.calendar_appointments;
create trigger trg_agenda_owner_ics_enqueue after insert or update of meeting_state,meeting_url on public.calendar_appointments
 for each row execute function public.fn_agenda_owner_ics_enqueue();

notify pgrst,'reload schema';
