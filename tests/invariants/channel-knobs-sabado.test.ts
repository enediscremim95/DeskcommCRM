import { beforeAll, describe, expect, it } from "vitest";

import { GOV_ORG, GOV_SESSION, seedGov, sql } from "./gov-helpers";

describe("0303 · fim de expediente do sábado", () => {
  beforeAll(() => {
    seedGov();
    sql(`
      insert into public.channel_knobs (organization_id, channel_session_id)
      values ('${GOV_ORG}', '${GOV_SESSION}')
      on conflict (organization_id, channel_session_id) do nothing;
    `);
  });

  it("chega ao baseline como smallint opcional", () => {
    expect(
      sql(`
        select data_type, is_nullable
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'channel_knobs'
          and column_name = 'window_saturday_end_hour';
      `),
    ).toBe("smallint|YES");
  });

  it("aceita nulo, zero e 24, mas recusa valores fora da faixa", () => {
    for (const value of ["null", "0", "24"]) {
      expect(() =>
        sql(`
          update public.channel_knobs
          set window_saturday_end_hour = ${value}
          where organization_id = '${GOV_ORG}'
            and channel_session_id = '${GOV_SESSION}';
        `),
      ).not.toThrow();
    }
    for (const value of [-1, 25]) {
      expect(() =>
        sql(`
          update public.channel_knobs
          set window_saturday_end_hour = ${value}
          where organization_id = '${GOV_ORG}'
            and channel_session_id = '${GOV_SESSION}';
        `),
      ).toThrow(/channel_knobs_window_saturday_end_hour_check/);
    }
  });

  it("a publicação do agente conhece e persiste o campo novo", () => {
    const definition = sql(`
      select pg_get_functiondef('public.fn_apply_agent_channel_config_on_publish()'::regprocedure);
    `);
    expect(definition).toContain("window_saturday_end_hour");
    expect(definition).toContain("c ? 'window_saturday_end_hour'");
  });

  it("preserva RLS e não abre privilégio novo", () => {
    const security = JSON.parse(
      sql(`
        select json_build_object(
          'rls_enabled', c.relrowsecurity,
          'anon_select', has_column_privilege(
            'anon', 'public.channel_knobs', 'window_saturday_end_hour', 'select'
          ),
          'anon_update', has_column_privilege(
            'anon', 'public.channel_knobs', 'window_saturday_end_hour', 'update'
          ),
          'authenticated_select', has_column_privilege(
            'authenticated', 'public.channel_knobs', 'window_saturday_end_hour', 'select'
          ),
          'authenticated_update', has_column_privilege(
            'authenticated', 'public.channel_knobs', 'window_saturday_end_hour', 'update'
          ),
          'tenant_policy', exists (
            select 1 from pg_policies
            where schemaname = 'public'
              and tablename = 'channel_knobs'
              and policyname = 'tenant_isolation_channel_knobs_all'
              and cmd = 'ALL'
          ),
          'publish_fn_anon', has_function_privilege(
            'anon', 'public.fn_apply_agent_channel_config_on_publish()', 'execute'
          ),
          'publish_fn_service', has_function_privilege(
            'service_role', 'public.fn_apply_agent_channel_config_on_publish()', 'execute'
          )
        )
        from pg_class c
        where c.oid = 'public.channel_knobs'::regclass;
      `),
    ) as Record<string, boolean>;

    expect(security).toEqual({
      rls_enabled: true,
      anon_select: false,
      anon_update: false,
      authenticated_select: true,
      authenticated_update: true,
      tenant_policy: true,
      publish_fn_anon: false,
      publish_fn_service: true,
    });
  });
});
