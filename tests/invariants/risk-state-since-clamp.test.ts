import { describe, expect, it } from "vitest";

import { sql } from "./gov-helpers";

describe("0288, início do risco no relógio do banco", () => {
  it("limita um `since` futuro à detecção sem remover o CHECK", () => {
    const resultado = sql(`
      begin;
      insert into public.organizations (id, slug, legal_name, display_name)
        values (
          '28800000-0000-4000-8000-000000000001',
          'risk-since-0288',
          'Risk Since 0288',
          'Risk Since 0288'
        );
      insert into public.crm_pipelines (id, organization_id, name, slug)
        values (
          '28800000-0000-4000-8000-000000000002',
          '28800000-0000-4000-8000-000000000001',
          'Pipeline 0288',
          'pipeline-0288'
        );
      insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position)
        values (
          '28800000-0000-4000-8000-000000000003',
          '28800000-0000-4000-8000-000000000001',
          '28800000-0000-4000-8000-000000000002',
          'Etapa 0288',
          'etapa-0288',
          1000
        );
      insert into public.crm_leads (
        id, organization_id, pipeline_id, stage_id, title
      ) values (
        '28800000-0000-4000-8000-000000000004',
        '28800000-0000-4000-8000-000000000001',
        '28800000-0000-4000-8000-000000000002',
        '28800000-0000-4000-8000-000000000003',
        'Lead 0288'
      );
      insert into public.crm_lead_risk_states (
        lead_id, organization_id, bucket, since, cold_hours
      ) values (
        '28800000-0000-4000-8000-000000000004',
        '28800000-0000-4000-8000-000000000001',
        'em_voo',
        now() + interval '24 hours',
        24
      ) returning (since = detected_at)::text;
      rollback;
    `);

    expect(resultado.split("\n")).toContain("true");
  });
});
