-- URL externa do relatório por organização. O CRM só controla o acesso, não gera métricas.
alter table public.organizations add column if not exists report_url text;

create or replace function public.fn_create_tenant_with_owner(
  p_actor uuid, p_key uuid, p_request jsonb, p_hash text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare prior public.idempotency_keys%rowtype; org public.organizations%rowtype; result jsonb;
begin
  if not exists (select 1 from public.platform_admins where user_id = p_actor and revoked_at is null and scope = 'full') then raise exception 'platform_admin_required' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor::text || ':' || p_key::text, 0));
  select * into prior from public.idempotency_keys where key = p_key::text and endpoint = '/api/v1/admin/tenants:' || p_actor::text and expires_at > now();
  if found then if prior.request_hash <> decode(p_hash, 'hex') then raise exception 'idempotency_conflict' using errcode = '22023'; end if; return prior.response_body || jsonb_build_object('created', false); end if;
  insert into public.organizations(display_name, slug, legal_name, cnpj, report_url, status, settings, created_by)
  values (p_request->>'display_name', p_request->>'slug', coalesce(nullif(p_request->>'legal_name', ''), p_request->>'display_name'), p_request->>'cnpj', nullif(p_request->>'report_url', ''), 'active', jsonb_build_object('plan', p_request->>'plan'), p_actor) returning * into org;
  insert into public.user_organizations(organization_id, user_id, role, accepted_at) values (org.id, p_actor, 'admin', now());
  result := jsonb_build_object('id', org.id, 'slug', org.slug, 'display_name', org.display_name, 'invite_id', gen_random_uuid(), 'issued_at', floor(extract(epoch from now()))::bigint);
  insert into public.idempotency_keys(organization_id, key, endpoint, request_hash, status_code, response_body) values (org.id, p_key::text, '/api/v1/admin/tenants:' || p_actor::text, decode(p_hash, 'hex'), 201, result);
  return result || jsonb_build_object('created', true);
end $$;
revoke all on function public.fn_create_tenant_with_owner(uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.fn_create_tenant_with_owner(uuid, uuid, jsonb, text) to service_role;
