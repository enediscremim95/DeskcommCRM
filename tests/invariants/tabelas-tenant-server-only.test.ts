import { describe, expect, it } from "vitest";

import { GOV_AGENT_A, GOV_ORG, seedGov, sql } from "./gov-helpers";

const TABELAS_SERVER_ONLY = [
  "channel_delivery_leases",
  "n8n_workflow_bindings",
  "organization_integration_permissions",
  "traffic_dashboard_accounts",
  "traffic_dashboard_configs",
  "traffic_dashboard_facts",
  "traffic_dashboard_sync_runs",
] as const;

describe("tabelas tenant-aware exclusivas do servidor", () => {
  it.each(TABELAS_SERVER_ONLY)("%s nega leitura ao authenticated mesmo com JWT do tenant", (tabela) => {
    seedGov();
    expect(() =>
      sql(`
        set role authenticated;
        select set_config('request.jwt.claims', '{"sub":"${GOV_AGENT_A}"}', false);
        select count(*) from public.${tabela} where organization_id = '${GOV_ORG}';
      `),
    ).toThrow(/permission denied/i);
  });

  it.each(TABELAS_SERVER_ONLY)("%s permanece acessível ao service_role", (tabela) => {
    expect(
      sql(`
        set role service_role;
        select count(*) from public.${tabela} where organization_id = '${GOV_ORG}';
      `).split("\n").pop(),
    ).toMatch(/^\d+$/);
  });
});
