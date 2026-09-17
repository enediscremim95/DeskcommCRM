-- 0244: entrega pronta sem fabricar aceite de termos. Funil semeado pelo trigger existente.
-- Ciphertext temporário exclusivo do service role; nenhuma senha plaintext no banco.
create table if not exists public.tenant_owner_access (
 organization_id uuid primary key references public.organizations(id) on delete cascade,
 email text not null, owner_interface_settings jsonb not null default '{"preset":"completa"}'::jsonb,
 encrypted_password text, user_id uuid references auth.users(id) on delete set null,
 status text not null default 'pending' check(status in ('pending','sent','existing_user')),
 lease_token uuid, lease_until timestamptz, created_at timestamptz not null default now()
);
alter table public.tenant_owner_access enable row level security;
revoke all on public.tenant_owner_access from public, anon, authenticated;
grant all on public.tenant_owner_access to service_role;
create or replace function public.fn_create_tenant_with_owner(
  p_actor uuid, p_key uuid, p_request jsonb, p_hash text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  prior public.idempotency_keys%rowtype;
  org public.organizations%rowtype;
  result jsonb;
begin
  if not exists (select 1 from public.platform_admins where user_id = p_actor
    and revoked_at is null and scope = 'full') then
    raise exception 'platform_admin_required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor::text || ':' || p_key::text, 0));
  select * into prior from public.idempotency_keys
    where key = p_key::text and endpoint = '/api/v1/admin/tenants:' || p_actor::text
      and expires_at > now() and tenant_creation_trusted;
  if found then
    if prior.request_hash <> decode(p_hash, 'hex') then
      raise exception 'idempotency_conflict' using errcode = '22023';
    end if;
    if prior.response_body->>'id' is distinct from prior.organization_id::text
      or not exists (select 1 from public.organizations where id = prior.organization_id and created_by = p_actor) then
      raise exception 'idempotency_provenance_invalid' using errcode = '22023';
    end if;
    return prior.response_body || jsonb_build_object('created', false);
  end if;
  insert into public.organizations(display_name, slug, legal_name, cnpj, report_url, status, settings, created_by, timezone, onboarded_at)
    values (p_request->>'display_name', p_request->>'slug', coalesce(nullif(p_request->>'legal_name', ''), p_request->>'display_name'),
      p_request->>'cnpj', nullif(p_request->>'report_url', ''), 'active', jsonb_build_object('plan', p_request->>'plan') || case when p_request->>'delivery_mode' = 'credentials' then jsonb_build_object('business_profile', p_request->'business_profile') else '{}'::jsonb end, p_actor, coalesce(nullif(p_request->>'timezone', ''), 'America/Sao_Paulo'), case when p_request->>'delivery_mode' = 'credentials' then now() else null end)
    returning * into org;
  insert into public.user_organizations(organization_id, user_id, role, accepted_at, interface_settings)
    values (org.id, p_actor, 'admin', now(), case when lower(p_request->>'owner_email') =
      (select lower(email) from auth.users where id = p_actor)
      then coalesce(p_request->'owner_interface_settings', '{"preset":"completa"}'::jsonb)
      else '{"preset":"completa"}'::jsonb end);
  if p_request->>'delivery_mode' = 'credentials' then
    insert into public.tenant_owner_access(organization_id, email, owner_interface_settings)
      values (org.id, lower(p_request->>'owner_email'), coalesce(p_request->'owner_interface_settings', '{"preset":"completa"}'::jsonb));
  end if;
  result := jsonb_build_object('id', org.id, 'slug', org.slug, 'display_name', org.display_name,
    'invite_id', gen_random_uuid(), 'issued_at', floor(extract(epoch from now()))::bigint);
  insert into public.idempotency_keys(organization_id, key, endpoint, request_hash, status_code, response_body, tenant_creation_trusted)
    values (org.id, p_key::text, '/api/v1/admin/tenants:' || p_actor::text,
      decode(p_hash, 'hex'), 201, result, true);
  return result || jsonb_build_object('created', true);
end $$;
revoke all on function public.fn_create_tenant_with_owner(uuid, uuid, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.fn_create_tenant_with_owner(uuid, uuid, jsonb, text)
  to service_role;

create or replace function public.fn_claim_tenant_owner_access(
 p_organization_id uuid, p_actor uuid, p_lease uuid, p_encrypted_password text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare delivery public.tenant_owner_access%rowtype; owner_user auth.users%rowtype; org_name text;
begin
 if not exists(select 1 from public.platform_admins where user_id=p_actor and revoked_at is null and scope='full') then raise exception 'platform_admin_required' using errcode='42501'; end if;
 select display_name into org_name from public.organizations where id=p_organization_id and status='active';
 if not found then raise exception 'active_organization_required' using errcode='22023'; end if;
 select * into delivery from public.tenant_owner_access where organization_id=p_organization_id for update;
 if not found then raise exception 'owner_access_not_found' using errcode='22023'; end if;
 if delivery.status in ('sent','existing_user') then return jsonb_build_object('status',delivery.status); end if;
 if delivery.lease_until > now() then return jsonb_build_object('status','busy'); end if;
 if p_lease is null or coalesce(delivery.encrypted_password,nullif(p_encrypted_password,'')) is null then raise exception 'owner_access_claim_invalid' using errcode='22023'; end if;
 update public.tenant_owner_access set encrypted_password=coalesce(encrypted_password,p_encrypted_password), lease_token=p_lease, lease_until=now()+interval '2 minutes' where organization_id=p_organization_id returning * into delivery;
 select * into owner_user from auth.users where lower(email)=lower(delivery.email) limit 1;
 return jsonb_build_object('status','claimed','email',delivery.email,'encrypted_password',delivery.encrypted_password,'user_id',owner_user.id,'owned_user',coalesce(owner_user.raw_app_meta_data->>'crm_provisioning_org'=p_organization_id::text,false),'owner_interface_settings',delivery.owner_interface_settings,'org_name',org_name);
end $$;
revoke all on function public.fn_claim_tenant_owner_access(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.fn_claim_tenant_owner_access(uuid,uuid,uuid,text) to service_role;

create or replace function public.fn_complete_tenant_owner_access(
 p_organization_id uuid,p_actor uuid,p_lease uuid,p_user_id uuid,p_status text
) returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare delivery public.tenant_owner_access%rowtype;
begin
 if not exists(select 1 from public.platform_admins where user_id=p_actor and revoked_at is null and scope='full') then raise exception 'platform_admin_required' using errcode='42501'; end if;
 if p_status is null or p_status not in ('linked','sent','existing_user','failed') then raise exception 'owner_access_status_invalid' using errcode='22023'; end if;
 select * into delivery from public.tenant_owner_access where organization_id=p_organization_id for update;
 if not found or delivery.lease_token is distinct from p_lease or p_lease is null or delivery.lease_until is null or delivery.lease_until<=now() then return false; end if;
 if not exists(select 1 from public.organizations where id=p_organization_id and status='active') then return false; end if;
 if p_status='linked' then
  if not exists(select 1 from auth.users where id=p_user_id and lower(email)=lower(delivery.email) and raw_app_meta_data->>'crm_provisioning_org'=p_organization_id::text) then raise exception 'owner_access_user_not_owned' using errcode='42501'; end if;
  insert into public.user_organizations(organization_id,user_id,role,accepted_at,interface_settings) values(p_organization_id,p_user_id,'admin',now(),delivery.owner_interface_settings) on conflict(organization_id,user_id) do nothing;
  update public.tenant_owner_access set user_id=p_user_id where organization_id=p_organization_id;
 elsif p_status='sent' then
  if delivery.user_id is null or delivery.user_id is distinct from p_user_id then return false; end if;
  update public.tenant_owner_access set status='sent',encrypted_password=null,lease_token=null,lease_until=null where organization_id=p_organization_id;
 elsif p_status='existing_user' then
  update public.tenant_owner_access set status='existing_user',encrypted_password=null,lease_token=null,lease_until=null where organization_id=p_organization_id;
 else
  update public.tenant_owner_access set lease_token=null,lease_until=null where organization_id=p_organization_id;
 end if;
 return true;
end $$;
revoke all on function public.fn_complete_tenant_owner_access(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.fn_complete_tenant_owner_access(uuid,uuid,uuid,uuid,text) to service_role;
