import { beforeAll, describe, expect, it } from "vitest";
import { countAs, sql } from "./gov-helpers";

const ORG_A = "fa254000-0000-4000-8000-00000000000a";
const ORG_B = "fa254000-0000-4000-8000-00000000000b";
const USER_A = "fa254000-1111-4000-8000-00000000000a";
const USER_B = "fa254000-1111-4000-8000-00000000000b";

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values
      ('${USER_A}', 'threshold-a@invariant.test'),
      ('${USER_B}', 'threshold-b@invariant.test') on conflict (id) do nothing;
    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_A}', 'threshold-a', 'Threshold A', 'Threshold A'),
      ('${ORG_B}', 'threshold-b', 'Threshold B', 'Threshold B') on conflict (id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
      ('${USER_A}', '${ORG_A}', 'viewer', now()),
      ('${USER_B}', '${ORG_B}', 'viewer', now()) on conflict do nothing;
    insert into public.traffic_report_cost_thresholds
      (organization_id, platform, good_until, acceptable_until) values
      ('${ORG_A}', 'meta_ads', 10, 20), ('${ORG_B}', 'meta_ads', 30, 40)
    on conflict (organization_id, platform) do update
      set good_until = excluded.good_until, acceptable_until = excluded.acceptable_until;
  `);
});

describe("limites de custo do relatório", () => {
  it("viewer lê apenas a própria organização", () => {
    expect(
      countAs(
        USER_A,
        `select count(*) from public.traffic_report_cost_thresholds where organization_id = '${ORG_A}'`,
      ),
    ).toBe(1);
    expect(
      countAs(
        USER_A,
        `select count(*) from public.traffic_report_cost_thresholds where organization_id = '${ORG_B}'`,
      ),
    ).toBe(0);
  });

  it("authenticated não grava diretamente", () => {
    expect(() =>
      sql(`
      set role authenticated;
      select set_config('request.jwt.claims', '{"sub":"${USER_A}"}', false);
      update public.traffic_report_cost_thresholds set good_until = 1 where organization_id = '${ORG_A}';
    `),
    ).toThrow();
  });
});
