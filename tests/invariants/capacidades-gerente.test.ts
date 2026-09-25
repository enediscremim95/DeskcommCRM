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

function capability(userId: string, name: "team.manage" | "lead.delete"): boolean {
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

  it("somente manager e platform admin recebem as capacidades nomeadas", () => {
    expect(capability(GOV_MANAGER, "team.manage")).toBe(true);
    expect(capability(GOV_MANAGER, "lead.delete")).toBe(true);
    expect(capability(GOV_ADMIN, "team.manage")).toBe(false);
    expect(capability(GOV_ADMIN, "lead.delete")).toBe(false);
    expect(capability(PLATFORM, "team.manage")).toBe(true);
    expect(capability(PLATFORM, "lead.delete")).toBe(true);
  });

  it("RLS deixa o gerente gerir a equipe e barra o admin da organização", () => {
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
    ).toBe(0);
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
});
