import { beforeAll, describe, expect, it } from "vitest";

import {
  GOV_ADMIN,
  GOV_MANAGER,
  GOV_ORG,
  GOV_PIPELINE,
  GOV_STAGE,
  lastLine,
  seedGov,
  sql,
  writeCountAs,
} from "./gov-helpers";

const TARGET = "c2640000-1111-4000-8000-000000000001";
const PLATFORM = "c2640000-1111-4000-8000-000000000002";
const LEAD_MANAGER = "c2640000-6666-4000-8000-000000000001";
const LEAD_ADMIN = "c2640000-6666-4000-8000-000000000002";
const LEAD_PLATFORM = "c2640000-6666-4000-8000-000000000003";
const CRED_MANAGER = "c2640000-7777-4000-8000-000000000001";
const CRED_ADMIN = "c2640000-7777-4000-8000-000000000002";
const CRED_PLATFORM = "c2640000-7777-4000-8000-000000000003";
const TOKEN_MANAGER = "c2640000-8888-4000-8000-000000000001";
const TOKEN_ADMIN = "c2640000-8888-4000-8000-000000000002";
const TOKEN_PLATFORM = "c2640000-8888-4000-8000-000000000003";
const TOKEN_CREATE_MANAGER = "c2640000-9999-4000-8000-000000000001";
const TOKEN_CREATE_ADMIN = "c2640000-9999-4000-8000-000000000002";
const TOKEN_CREATE_PLATFORM = "c2640000-9999-4000-8000-000000000003";

function capability(
  userId: string,
  name:
    | "team.manage"
    | "lead.delete"
    | "ai.credentials.delete"
    | "organization.data.reset"
    | "api.tokens.manage",
): boolean {
  return lastLine(
    sql(`
      select set_config('request.jwt.claims', '{"sub":"${userId}"}', false);
      select public.fn_has_capability('${GOV_ORG}', '${name}')::text;
    `),
  ) === "true";
}

function seedProbes(): void {
  sql(`
    insert into auth.users (id, email)
      values ('${TARGET}', 'cap-target@invariant.test'),
             ('${PLATFORM}', 'cap-platform@invariant.test')
      on conflict do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${TARGET}', '${GOV_ORG}', 'agent', now())
      on conflict (user_id, organization_id) do update
        set role = 'agent', revoked_at = null;
    insert into public.platform_admins (user_id, granted_by, reason)
      values ('${PLATFORM}', '${GOV_ADMIN}', 'invariante de capacidades 0264')
      on conflict (user_id) do update set revoked_at = null;
    insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, title)
      values ('${LEAD_MANAGER}', '${GOV_ORG}', '${GOV_PIPELINE}', '${GOV_STAGE}', 'Excluir gerente'),
             ('${LEAD_ADMIN}', '${GOV_ORG}', '${GOV_PIPELINE}', '${GOV_STAGE}', 'Preservar admin'),
             ('${LEAD_PLATFORM}', '${GOV_ORG}', '${GOV_PIPELINE}', '${GOV_STAGE}', 'Excluir plataforma')
      on conflict do nothing;
    insert into public.ai_provider_credentials
      (id, organization_id, provider, label, api_key_encrypted, api_key_iv, api_key_tag, api_key_last4)
      values ('${CRED_MANAGER}', '${GOV_ORG}', 'anthropic', 'Excluir gerente', '\\x01'::bytea, '\\x02'::bytea, '\\x03'::bytea, '1001'),
             ('${CRED_ADMIN}', '${GOV_ORG}', 'openai', 'Excluir admin', '\\x01'::bytea, '\\x02'::bytea, '\\x03'::bytea, '1002'),
             ('${CRED_PLATFORM}', '${GOV_ORG}', 'google', 'Excluir plataforma', '\\x01'::bytea, '\\x02'::bytea, '\\x03'::bytea, '1003')
      on conflict do nothing;
    delete from public.api_tokens
      where id in ('${TOKEN_CREATE_MANAGER}', '${TOKEN_CREATE_ADMIN}', '${TOKEN_CREATE_PLATFORM}');
    insert into public.api_tokens
      (id, organization_id, created_by, name, prefix, token_hash)
      values ('${TOKEN_MANAGER}', '${GOV_ORG}', '${GOV_ADMIN}', 'Revogar gerente', 'cap_mgr', '\\x11'::bytea),
             ('${TOKEN_ADMIN}', '${GOV_ORG}', '${GOV_ADMIN}', 'Revogar admin', 'cap_adm', '\\x12'::bytea),
             ('${TOKEN_PLATFORM}', '${GOV_ORG}', '${GOV_ADMIN}', 'Revogar plataforma', 'cap_plt', '\\x13'::bytea)
      on conflict do nothing;
  `);
}

beforeAll(() => {
  seedGov();
  seedProbes();
});

describe("0264: capacidades do gerente", () => {
  it("manager e admin empatam no acesso geral", () => {
    const vector = (userId: string) =>
      lastLine(
        sql(`
          select set_config('request.jwt.claims', '{"sub":"${userId}"}', false);
          select public.fn_role_at_least('${GOV_ORG}', 'admin')::int::text;
        `),
      );
    expect(vector(GOV_MANAGER)).toBe("1");
    expect(vector(GOV_ADMIN)).toBe("1");
  });

  it("separa as capacidades destrutivas sem desfazer o acesso geral", () => {
    expect(capability(GOV_MANAGER, "team.manage")).toBe(true);
    expect(capability(GOV_MANAGER, "lead.delete")).toBe(true);
    expect(capability(GOV_MANAGER, "ai.credentials.delete")).toBe(false);
    expect(capability(GOV_MANAGER, "organization.data.reset")).toBe(false);
    expect(capability(GOV_MANAGER, "api.tokens.manage")).toBe(false);
    expect(capability(GOV_ADMIN, "team.manage")).toBe(true);
    expect(capability(GOV_ADMIN, "lead.delete")).toBe(false);
    expect(capability(GOV_ADMIN, "ai.credentials.delete")).toBe(true);
    expect(capability(GOV_ADMIN, "organization.data.reset")).toBe(true);
    expect(capability(GOV_ADMIN, "api.tokens.manage")).toBe(true);
    expect(capability(PLATFORM, "team.manage")).toBe(true);
    expect(capability(PLATFORM, "lead.delete")).toBe(true);
    expect(capability(PLATFORM, "ai.credentials.delete")).toBe(true);
    expect(capability(PLATFORM, "organization.data.reset")).toBe(true);
    expect(capability(PLATFORM, "api.tokens.manage")).toBe(true);
  });

  it("RLS deixa gerente, admin da organização e plataforma gerir a equipe", () => {
    expect(
      writeCountAs(
        GOV_MANAGER,
        `update public.user_organizations set role = 'viewer'
          where organization_id = '${GOV_ORG}' and user_id = '${TARGET}'`,
      ),
    ).toBe(1);
    sql(`update public.user_organizations set role = 'agent' where user_id = '${TARGET}' and organization_id = '${GOV_ORG}';`);
    expect(
      writeCountAs(
        GOV_ADMIN,
        `update public.user_organizations set role = 'viewer'
          where organization_id = '${GOV_ORG}' and user_id = '${TARGET}'`,
      ),
    ).toBe(1);
    expect(
      writeCountAs(
        PLATFORM,
        `update public.user_organizations set role = 'viewer'
          where organization_id = '${GOV_ORG}' and user_id = '${TARGET}'`,
      ),
    ).toBe(1);
  });

  it("RLS deixa gerente e plataforma excluir lead, mas barra admin da organização", () => {
    expect(writeCountAs(GOV_MANAGER, `delete from public.crm_leads where id = '${LEAD_MANAGER}'`)).toBe(1);
    expect(writeCountAs(GOV_ADMIN, `delete from public.crm_leads where id = '${LEAD_ADMIN}'`)).toBe(0);
    expect(writeCountAs(PLATFORM, `delete from public.crm_leads where id = '${LEAD_PLATFORM}'`)).toBe(1);
  });

  it("RLS barra gerente de apagar credencial de IA, mas libera admin e plataforma", () => {
    expect(
      writeCountAs(
        GOV_MANAGER,
        `delete from public.ai_provider_credentials where id = '${CRED_MANAGER}'`,
      ),
    ).toBe(0);
    expect(
      writeCountAs(
        GOV_ADMIN,
        `delete from public.ai_provider_credentials where id = '${CRED_ADMIN}'`,
      ),
    ).toBe(1);
    expect(
      writeCountAs(
        PLATFORM,
        `delete from public.ai_provider_credentials where id = '${CRED_PLATFORM}'`,
      ),
    ).toBe(1);
  });

  it("RLS barra gerente de criar e revogar token, mas libera admin e plataforma", () => {
    expect(
      writeCountAs(
        GOV_MANAGER,
        `insert into public.api_tokens
          (id, organization_id, created_by, name, prefix, token_hash)
          values ('${TOKEN_CREATE_MANAGER}', '${GOV_ORG}', '${GOV_MANAGER}', 'Criar gerente', 'create_mgr', '\\x21'::bytea)`,
      ),
    ).toBe(0);
    expect(
      writeCountAs(
        GOV_ADMIN,
        `insert into public.api_tokens
          (id, organization_id, created_by, name, prefix, token_hash)
          values ('${TOKEN_CREATE_ADMIN}', '${GOV_ORG}', '${GOV_ADMIN}', 'Criar admin', 'create_adm', '\\x22'::bytea)`,
      ),
    ).toBe(1);
    expect(
      writeCountAs(
        PLATFORM,
        `insert into public.api_tokens
          (id, organization_id, created_by, name, prefix, token_hash)
          values ('${TOKEN_CREATE_PLATFORM}', '${GOV_ORG}', '${PLATFORM}', 'Criar plataforma', 'create_plt', '\\x23'::bytea)`,
      ),
    ).toBe(1);

    expect(
      writeCountAs(
        GOV_MANAGER,
        `update public.api_tokens set revoked_at = now(), revoked_by = '${GOV_MANAGER}'
          where id = '${TOKEN_MANAGER}'`,
      ),
    ).toBe(0);
    expect(
      writeCountAs(
        GOV_ADMIN,
        `update public.api_tokens set revoked_at = now(), revoked_by = '${GOV_ADMIN}'
          where id = '${TOKEN_ADMIN}'`,
      ),
    ).toBe(1);
    expect(
      writeCountAs(
        PLATFORM,
        `update public.api_tokens set revoked_at = now(), revoked_by = '${PLATFORM}'
          where id = '${TOKEN_PLATFORM}'`,
      ),
    ).toBe(1);
  });
});
