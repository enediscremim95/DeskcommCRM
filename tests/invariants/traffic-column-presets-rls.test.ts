import { beforeAll, describe, expect, it } from "vitest";

import { countAs, sql } from "./gov-helpers";

const ORG_A = "fa250000-0000-4000-8000-00000000000a";
const ORG_B = "fa250000-0000-4000-8000-00000000000b";
const USER_A = "fa250000-1111-4000-8000-00000000000a";
const USER_B = "fa250000-1111-4000-8000-00000000000b";
const PRESET_A = "fa250000-2222-4000-8000-00000000000a";
const PRESET_B = "fa250000-2222-4000-8000-00000000000b";
const PRESET_A_GOOGLE = "fa250000-2222-4000-8000-00000000000c";

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values
      ('${USER_A}', 'preset-a@invariant.test'),
      ('${USER_B}', 'preset-b@invariant.test')
    on conflict (id) do nothing;

    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_A}', 'preset-inv-a', 'Preset Invariant A', 'Preset A'),
      ('${ORG_B}', 'preset-inv-b', 'Preset Invariant B', 'Preset B')
    on conflict (id) do nothing;

    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
      ('${USER_A}', '${ORG_A}', 'viewer', now()),
      ('${USER_B}', '${ORG_B}', 'viewer', now())
    on conflict do nothing;

    insert into public.traffic_dashboard_configs
      (organization_id, model, conversion_fields, enabled)
    values
      ('${ORG_A}', 'leads', array['conversions'], true),
      ('${ORG_B}', 'leads', array['conversions'], true)
    on conflict (organization_id) do nothing;

    insert into public.traffic_dashboard_column_presets
      (id, organization_id, name, metric_columns, platform)
    values
      ('${PRESET_A}', '${ORG_A}', 'Captação', array['spend','leads'], 'meta_ads'),
      ('${PRESET_A_GOOGLE}', '${ORG_A}', 'Captação', array['spend','leads'], 'google_ads'),
      ('${PRESET_B}', '${ORG_B}', 'Vendas', array['spend','purchases'], 'meta_ads')
    on conflict (id) do nothing;

    update public.traffic_dashboard_configs
       set default_meta_column_preset_id = case organization_id
             when '${ORG_A}' then '${PRESET_A}'::uuid
             when '${ORG_B}' then '${PRESET_B}'::uuid
           end,
           default_google_column_preset_id = case organization_id
             when '${ORG_A}' then '${PRESET_A_GOOGLE}'::uuid
             else null
           end
     where organization_id in ('${ORG_A}', '${ORG_B}');
  `);
});

describe("predefinições de colunas do Relatório", () => {
  it("viewer lê a predefinição da própria organização", () => {
    expect(
      countAs(
        USER_A,
        `select count(*) from public.traffic_dashboard_column_presets where organization_id = '${ORG_A}';`,
      ),
    ).toBe(2);
  });

  it("viewer não enxerga a predefinição da organização vizinha", () => {
    expect(
      countAs(
        USER_A,
        `select count(*) from public.traffic_dashboard_column_presets where organization_id = '${ORG_B}';`,
      ),
    ).toBe(0);
  });

  it("authenticated não grava direto, mesmo dentro da própria organização", () => {
    expect(() =>
      sql(`
        set role authenticated;
        select set_config('request.jwt.claims', '{"sub":"${USER_A}"}', false);
        insert into public.traffic_dashboard_column_presets
          (organization_id, name, metric_columns, platform)
        values ('${ORG_A}', 'Sem rota', array['spend'], 'meta_ads');
      `),
    ).toThrow();
  });

  it("a FK composta impede uma configuração de apontar para preset de outra organização", () => {
    expect(() =>
      sql(`
        update public.traffic_dashboard_configs
           set default_google_column_preset_id = '${PRESET_B}'
         where organization_id = '${ORG_A}';
      `),
    ).toThrow();
  });

  it("o banco recusa métricas sem dado na plataforma Google", () => {
    expect(() =>
      sql(`
        insert into public.traffic_dashboard_column_presets
          (organization_id, name, metric_columns, platform)
        values ('${ORG_A}', 'Google inválido', array['spend','reach'], 'google_ads');
      `),
    ).toThrow();
  });
});
