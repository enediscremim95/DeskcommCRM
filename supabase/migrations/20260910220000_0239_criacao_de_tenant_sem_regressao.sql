-- 0234: devolve à criação de tenant o que a 0232 derrubou sem querer
--
-- ═══ O DEFEITO ═══
--
-- A 0232 (URL do relatório) precisava acrescentar UMA coluna ao insert de
-- `fn_create_tenant_with_owner`. Ela reescreveu a função a partir de uma cópia
-- ANTIGA — anterior à 0221 — e com isso desfez, em silêncio, três coisas que a
-- 0221 tinha posto lá. `create or replace function` não avisa que o corpo novo
-- perdeu metade do antigo: ele aceita.
--
-- O que voltou a faltar, medido pelos invariantes no CI:
--
-- (1) `user_organizations.interface_settings` não era mais gravado. Quem cria a
--     organização escolhe a área de trabalho do dono no formulário
--     (`owner_interface_settings`, validado pelo `createTenantSchema`), e a
--     escolha era descartada: todo dono caía no preset `completa`. O campo da
--     tela existia e não fazia nada.
--     Acusado por `tests/invariants/interface-por-vinculo.test.ts` com a
--     mensagem "owner interface lost".
--
-- (2) `idempotency_keys.tenant_creation_trusted` não era mais gravado nem
--     exigido na leitura. É a marca de "este recibo foi produzido pelo
--     servidor". Sem ela, um recibo plantado na tabela por outro caminho voltava
--     a ser aceito como resposta de uma criação que nunca houve.
--
-- (3) A conferência de procedência do recibo (`idempotency_provenance_invalid`)
--     tinha desaparecido: o replay não verificava mais se o `id` devolvido é a
--     organização daquele recibo, nem se ela foi criada pelo mesmo ator.
--     (2) e (3) são acusados por
--     `tests/invariants/organizacoes-recibo-confiavel.test.ts`.
--
-- ═══ POR QUE UMA MIGRATION NOVA, E NÃO UM CONSERTO NA 0232 ═══
--
-- A doutrina do repositório proíbe editar migration já aplicada: quem clonou e
-- atualizou já rodou a 0232, e mudar o arquivo não alcança esse banco. O
-- caminho é forward-fix — e ela é idempotente, então vale tanto para quem
-- aplicou a 0232 quanto para quem vai aplicar as duas de uma vez.
--
-- ═══ O QUE ESTA VERSÃO É ═══
--
-- A função da 0221, intacta, MAIS a coluna `report_url` que a 0232 queria
-- acrescentar. Nada a mais. A lição: ao mexer numa `create or replace`, parta da
-- versão em vigor no arquivo mais recente que a define, nunca de memória.

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
  insert into public.organizations(display_name, slug, legal_name, cnpj, report_url, status, settings, created_by)
    values (p_request->>'display_name', p_request->>'slug', coalesce(nullif(p_request->>'legal_name', ''), p_request->>'display_name'),
      p_request->>'cnpj', nullif(p_request->>'report_url', ''), 'active', jsonb_build_object('plan', p_request->>'plan'), p_actor)
    returning * into org;
  insert into public.user_organizations(organization_id, user_id, role, accepted_at, interface_settings)
    values (org.id, p_actor, 'admin', now(), case when lower(p_request->>'owner_email') =
      (select lower(email) from auth.users where id = p_actor)
      then coalesce(p_request->'owner_interface_settings', '{"preset":"completa"}'::jsonb)
      else '{"preset":"completa"}'::jsonb end);
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
