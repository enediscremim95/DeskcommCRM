import { describe, expect, it } from "vitest";
import { sql } from "./gov-helpers";

const actor = "f2440000-0000-4000-8000-000000000001";
const owner = "f2440000-0000-4000-8000-000000000002";
const lease = "f2440000-0000-4000-8000-000000000003";
const key = "f2440000-0000-4000-8000-000000000004";
const request = `'{"display_name":"Cliente","slug":"entrega-0244","plan":"standard","owner_email":"owner244@invariant.test","delivery_mode":"credentials","business_profile":{"segment":"services"},"timezone":"America/Manaus","owner_interface_settings":{"preset":"completa"}}'`;
const create = `public.fn_create_tenant_with_owner('${actor}','${key}',${request},'abcd')`;
function prove(body: string) {
  expect(sql(`begin;
    insert into auth.users(id,email) values('${actor}','actor244@invariant.test'),('${owner}','owner244@invariant.test');
    insert into public.platform_admins(user_id,granted_by,scope,mfa_required,reason) values('${actor}','${actor}','full',false,'Invariant');
    do $$ declare r jsonb; again jsonb; org uuid; c jsonb; begin
    r := ${create}; org := (r->>'id')::uuid;
    ${body}
    end $$; rollback; select 'proved';`)).toContain("proved");
}

describe("entrega de acesso do dono", () => {
  it("cria pronta, preserva perfil e replay sem duplicar funil nem acesso", () => prove(`
    again := ${create};
    if again <> r || jsonb_build_object('created',false) then raise exception 'replay'; end if;
    if not exists(select 1 from public.organizations where id=org and onboarded_at is not null and timezone='America/Manaus' and settings->'business_profile'='{"segment":"services"}'::jsonb) then raise exception 'profile'; end if;
    if (select count(*) from public.crm_pipelines where organization_id=org and is_default)<>1 then raise exception 'pipeline'; end if;
    if (select count(*) from public.tenant_owner_access where organization_id=org)<>1 then raise exception 'delivery'; end if;
  `));

  it("lease exclui concorrente e retoma mesmo ciphertext; dono preexistente nunca recebe vinculo", () => prove(`
    c := public.fn_claim_tenant_owner_access(org,'${actor}','${lease}','cipher-A');
    if c->>'status'<>'claimed' or (c->>'owned_user')::boolean then raise exception 'claim'; end if;
    if public.fn_claim_tenant_owner_access(org,'${actor}',gen_random_uuid(),'cipher-B')->>'status'<>'busy' then raise exception 'concurrent claim'; end if;
    begin
      perform public.fn_complete_tenant_owner_access(org,'${actor}','${lease}','${owner}','linked');
      raise exception 'foreign user linked';
    exception when insufficient_privilege then null; end;
    if public.fn_complete_tenant_owner_access(org,'${actor}',gen_random_uuid(),'${owner}','failed') then raise exception 'wrong lease'; end if;
    update public.tenant_owner_access set lease_until=now()-interval '1 second' where organization_id=org;
    if public.fn_complete_tenant_owner_access(org,'${actor}','${lease}','${owner}','failed') then raise exception 'expired lease'; end if;
    c := public.fn_claim_tenant_owner_access(org,'${actor}','${lease}','cipher-B');
    if c->>'encrypted_password'<>'cipher-A' then raise exception 'password replaced'; end if;
    perform public.fn_complete_tenant_owner_access(org,'${actor}','${lease}',null,'existing_user');
    if public.fn_claim_tenant_owner_access(org,'${actor}','${lease}','cipher-C')->>'status'<>'existing_user' then raise exception 'existing retried'; end if;
    if exists(select 1 from public.tenant_owner_access where organization_id=org and encrypted_password is not null) then raise exception 'cipher retained'; end if;
  `));

  it("vincula apenas usuário criado para essa org e limpa segredo ao enviar", () => prove(`
    update auth.users set raw_app_meta_data=jsonb_build_object('crm_provisioning_org',org::text) where id='${owner}';
    c := public.fn_claim_tenant_owner_access(org,'${actor}','${lease}','cipher-A');
    if not (c->>'owned_user')::boolean then raise exception 'marker'; end if;
    if public.fn_complete_tenant_owner_access(org,'${actor}','${lease}','${owner}','sent') then raise exception 'sent without link'; end if;
    if not public.fn_complete_tenant_owner_access(org,'${actor}','${lease}','${owner}','linked') then raise exception 'link'; end if;
    perform public.fn_complete_tenant_owner_access(org,'${actor}','${lease}','${owner}','linked');
    if (select count(*) from public.user_organizations where organization_id=org and user_id='${owner}' and role='admin' and accepted_at is not null)<>1 then raise exception 'membership'; end if;
    if not public.fn_complete_tenant_owner_access(org,'${actor}','${lease}','${owner}','sent') then raise exception 'sent'; end if;
    if exists(select 1 from public.tenant_owner_access where organization_id=org and (encrypted_password is not null or lease_token is not null)) then raise exception 'secret'; end if;
    if public.fn_claim_tenant_owner_access(org,'${actor}','${lease}','cipher-B')->>'status'<>'sent' then raise exception 'sent retried'; end if;
  `));

  it("somente service role tem tabela/RPC e ator precisa de escopo full", () => prove(`
    if has_table_privilege('authenticated','public.tenant_owner_access','SELECT') or has_table_privilege('anon','public.tenant_owner_access','SELECT') then raise exception 'table exposed'; end if;
    if has_function_privilege('authenticated','public.fn_claim_tenant_owner_access(uuid,uuid,uuid,text)','EXECUTE') or has_function_privilege('anon','public.fn_complete_tenant_owner_access(uuid,uuid,uuid,uuid,text)','EXECUTE') then raise exception 'RPC exposed'; end if;
    if not (select relrowsecurity from pg_class where oid='public.tenant_owner_access'::regclass) then raise exception 'RLS missing'; end if;
    begin
      perform public.fn_claim_tenant_owner_access(org,'${owner}','${lease}','cipher'); raise exception 'ordinary user allowed';
    exception when insufficient_privilege then null; end;
    update public.platform_admins set revoked_at=now() where user_id='${actor}';
    begin
      perform public.fn_complete_tenant_owner_access(org,'${actor}','${lease}','${owner}','failed'); raise exception 'revoked allowed';
    exception when insufficient_privilege then null; end;
  `));

  it("convite não cria entrega de credenciais, mas a organização já nasce pronta", () => prove(`
    again := public.fn_create_tenant_with_owner('${actor}',gen_random_uuid(),${request}::jsonb-'delivery_mode'||'{"slug":"legacy244"}'::jsonb,'abcd');
    if exists(select 1 from public.tenant_owner_access where organization_id=(again->>'id')::uuid) then raise exception 'legacy delivery'; end if;
    if not exists(select 1 from public.organizations where id=(again->>'id')::uuid and onboarded_at is not null) then raise exception 'invite entered onboarding'; end if;
  `));
});
