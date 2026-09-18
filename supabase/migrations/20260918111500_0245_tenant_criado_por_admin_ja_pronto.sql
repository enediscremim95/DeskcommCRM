-- 0245: toda organização criada pela administração da plataforma já foi
-- configurada pela agência e, por isso, não entra no onboarding do self-host.
--
-- Forward-fix da 0244. Reescreve a função inteira para preservar idempotência,
-- procedência, interface por vínculo e entrega de acesso. A única mudança é
-- `onboarded_at = now()` em qualquer delivery_mode.
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
      p_request->>'cnpj', nullif(p_request->>'report_url', ''), 'active', jsonb_build_object('plan', p_request->>'plan') || case when p_request->>'delivery_mode' = 'credentials' then jsonb_build_object('business_profile', p_request->'business_profile') else '{}'::jsonb end, p_actor, coalesce(nullif(p_request->>'timezone', ''), 'America/Sao_Paulo'), now())
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
revoke execute on function public.fn_create_tenant_with_owner(uuid, uuid, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.fn_create_tenant_with_owner(uuid, uuid, jsonb, text)
  to service_role;
