import { beforeAll, describe, expect, it } from "vitest";

import { sql } from "./gov-helpers";

const ORG = "d2790000-0000-4000-8000-000000000001";
const PIPELINE = "d2790000-0000-4000-8000-000000000002";
const LOST_STAGE = "d2790000-0000-4000-8000-000000000003";

describe("0279 · detalhe do motivo da perda", () => {
  beforeAll(() => {
    sql(`
      insert into public.organizations (id, slug, legal_name, display_name)
      values ('${ORG}', 'detalhe-perda', 'Detalhe Perda', 'Detalhe Perda')
      on conflict do nothing;

      insert into public.crm_pipelines (id, organization_id, name, slug, settings)
      values (
        '${PIPELINE}', '${ORG}', 'Detalhe Perda', 'detalhe-perda',
        jsonb_build_object('fields', '[]'::jsonb, 'lost_reasons', jsonb_build_array('Motivo cadastrado hoje'))
      ) on conflict do nothing;

      insert into public.crm_stages (
        id, organization_id, pipeline_id, name, slug, position, is_lost
      ) values (
        '${LOST_STAGE}', '${ORG}', '${PIPELINE}', 'Perdido', 'perdido', 1000, true
      ) on conflict do nothing;
    `);
  });

  it("a coluna chega pelo baseline e limita o mesmo tamanho aceito pela API", () => {
    expect(
      sql(`select data_type || ':' || is_nullable from information_schema.columns
            where table_schema='public' and table_name='crm_leads'
              and column_name='lost_reason_detail'`),
    ).toBe("text:YES");
    expect(
      sql(`select count(*) from pg_constraint
            where conname='crm_leads_lost_reason_detail_length'`),
    ).toBe("1");
  });

  it("guarda detalhe com other sem alterar a categoria", () => {
    const leadId = sql(`
      insert into public.crm_leads (
        organization_id, pipeline_id, stage_id, title, status, lost_reason, lost_reason_detail
      ) values (
        '${ORG}', '${PIPELINE}', '${LOST_STAGE}', 'Outro com detalhe', 'lost',
        'other', 'Cliente mudou de cidade'
      ) returning id
    `)
      // O psql imprime o id e depois a linha "INSERT 0 1": só a primeira é o id.
      .split("\n")[0]!
      .trim();

    expect(
      sql(`select lost_reason || ':' || lost_reason_detail from public.crm_leads where id='${leadId}'`),
    ).toBe("other:Cliente mudou de cidade");
  });

  it("mantém legível o motivo livre já cadastrado no funil", () => {
    const leadId = sql(`
      insert into public.crm_leads (
        organization_id, pipeline_id, stage_id, title, status, lost_reason
      ) values (
        '${ORG}', '${PIPELINE}', '${LOST_STAGE}', 'Legado preservado', 'lost',
        'Motivo cadastrado hoje'
      ) returning id
    `)
      // O psql imprime o id e depois a linha "INSERT 0 1": só a primeira é o id.
      .split("\n")[0]!
      .trim();

    expect(
      sql(`select lost_reason from public.crm_leads where id='${leadId}'`),
    ).toBe("Motivo cadastrado hoje");
  });
});
