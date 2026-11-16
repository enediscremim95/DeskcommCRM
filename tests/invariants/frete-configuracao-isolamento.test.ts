import { describe, expect, it } from "vitest";

import { lastLine, sql } from "./gov-helpers";

const ORG_A = "fa301000-0000-4000-8000-000000000001";
const ORG_B = "fa301000-0000-4000-8000-000000000002";

describe("configuração de frete exclusiva da service role", () => {
  it("nasce com RLS, sem policy e sem privilégio para navegador", () => {
    const estado = sql(`
      select c.relrowsecurity::text || '|' ||
             (select count(*) from pg_policies p
               where p.schemaname='public' and p.tablename='organization_shipping_settings') || '|' ||
             has_table_privilege('anon', c.oid, 'SELECT')::text || '|' ||
             has_table_privilege('authenticated', c.oid, 'SELECT')::text || '|' ||
             has_table_privilege('service_role', c.oid, 'SELECT')::text
        from pg_class c
        join pg_namespace n on n.oid=c.relnamespace
       where n.nspname='public' and c.relname='organization_shipping_settings';
    `);
    expect(estado).toBe("true|0|false|false|true");
  });

  it("service role lê as duas organizações e os demais papéis não leem nenhuma", () => {
    sql(`
      insert into public.organizations (id, slug, legal_name, display_name) values
        ('${ORG_A}', 'frete-inv-a', 'Frete A', 'Frete A'),
        ('${ORG_B}', 'frete-inv-b', 'Frete B', 'Frete B')
      on conflict (id) do nothing;
      insert into public.organization_shipping_settings (
        organization_id,base_url,user_agent,origin_postal_code,token_ciphertext,ativo
      ) values
        ('${ORG_A}','https://melhorenvio.com.br/api/v2','Frete A','80000000','\\x01',true),
        ('${ORG_B}','https://melhorenvio.com.br/api/v2','Frete B','88000000','\\x02',true)
      on conflict (organization_id) do update set ativo=excluded.ativo;
    `);
    // `set role` imprime "SET" antes do resultado: lê só a última linha.
    expect(
      lastLine(
        sql(`set role service_role;
             select count(*) from public.organization_shipping_settings
              where organization_id in ('${ORG_A}','${ORG_B}');`),
      ),
    ).toBe("2");
    for (const papel of ["anon", "authenticated"]) {
      expect(
        sql(`select has_table_privilege('${papel}','public.organization_shipping_settings','SELECT');`),
      ).toBe("f");
    }
  });
});
