import { beforeAll, describe, expect, it } from "vitest";

import { sql } from "./gov-helpers";

/**
 * A função 0284 só é uma otimização válida se devolver exatamente o mesmo que
 * os COUNTs antigos, executados etapa por etapa sob a mesma sessão e RLS.
 */

const ORG_A = "b2840000-0000-4000-8000-000000000001";
const ORG_B = "b2840000-0000-4000-8000-000000000002";
const PIPELINE_A = "b2840000-0000-4000-8000-000000000011";
const PIPELINE_B = "b2840000-0000-4000-8000-000000000012";
const STAGE_A_1 = "b2840000-0000-4000-8000-000000000021";
const STAGE_A_2 = "b2840000-0000-4000-8000-000000000022";
const STAGE_B = "b2840000-0000-4000-8000-000000000023";

const VIEWER = "b2840000-1000-4000-8000-000000000001";
const MANAGER = "b2840000-1000-4000-8000-000000000002";
const ADMIN = "b2840000-1000-4000-8000-000000000003";
const AGENT = "b2840000-1000-4000-8000-000000000004";
const OTHER_AGENT = "b2840000-1000-4000-8000-000000000005";
const OTHER_ORG_AGENT = "b2840000-1000-4000-8000-000000000006";

interface Caso {
  readonly nome: string;
  readonly userId: string;
  readonly visibilityMode?: "all" | "own" | "own_and_unassigned";
}

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values
      ('${VIEWER}', 'contagem-0284-viewer@invariant.test'),
      ('${MANAGER}', 'contagem-0284-manager@invariant.test'),
      ('${ADMIN}', 'contagem-0284-admin@invariant.test'),
      ('${AGENT}', 'contagem-0284-agent@invariant.test'),
      ('${OTHER_AGENT}', 'contagem-0284-other-agent@invariant.test'),
      ('${OTHER_ORG_AGENT}', 'contagem-0284-other-org@invariant.test')
    on conflict do nothing;

    insert into public.organizations (id, slug, legal_name, display_name, settings) values
      ('${ORG_A}', 'contagem-0284-a', 'Contagem 0284 A', 'Contagem 0284 A',
       jsonb_build_object('visibility_mode', 'own_and_unassigned')),
      ('${ORG_B}', 'contagem-0284-b', 'Contagem 0284 B', 'Contagem 0284 B',
       jsonb_build_object('visibility_mode', 'all'))
    on conflict do nothing;

    insert into public.user_organizations
      (user_id, organization_id, role, accepted_at, revoked_at) values
      ('${VIEWER}', '${ORG_A}', 'viewer', now(), null),
      ('${MANAGER}', '${ORG_A}', 'manager', now(), null),
      ('${ADMIN}', '${ORG_A}', 'admin', now(), null),
      ('${AGENT}', '${ORG_A}', 'agent', now(), null),
      ('${OTHER_AGENT}', '${ORG_A}', 'agent', now(), null),
      ('${OTHER_ORG_AGENT}', '${ORG_B}', 'agent', now(), null)
    on conflict do nothing;

    insert into public.crm_pipelines (id, organization_id, name, slug) values
      ('${PIPELINE_A}', '${ORG_A}', 'Contagem 0284 A', 'contagem-0284-a'),
      ('${PIPELINE_B}', '${ORG_B}', 'Contagem 0284 B', 'contagem-0284-b')
    on conflict do nothing;

    insert into public.crm_stages
      (id, organization_id, pipeline_id, name, slug, position) values
      ('${STAGE_A_1}', '${ORG_A}', '${PIPELINE_A}', 'Entrada', 'entrada', 1000),
      ('${STAGE_A_2}', '${ORG_A}', '${PIPELINE_A}', 'Decisão', 'decisao', 2000),
      ('${STAGE_B}', '${ORG_B}', '${PIPELINE_B}', 'Outra organização', 'outra-org', 1000)
    on conflict do nothing;

    insert into public.crm_leads
      (id, organization_id, pipeline_id, stage_id, title, status, owner_user_id,
       lost_reason, closed_at) values
      ('b2840000-3000-4000-8000-000000000001', '${ORG_A}', '${PIPELINE_A}', '${STAGE_A_1}', 'A do agente', 'open', '${AGENT}', null, null),
      ('b2840000-3000-4000-8000-000000000002', '${ORG_A}', '${PIPELINE_A}', '${STAGE_A_1}', 'A sem dono', 'open', null, null, null),
      ('b2840000-3000-4000-8000-000000000003', '${ORG_A}', '${PIPELINE_A}', '${STAGE_A_1}', 'A de outro agente', 'open', '${OTHER_AGENT}', null, null),
      ('b2840000-3000-4000-8000-000000000004', '${ORG_A}', '${PIPELINE_A}', '${STAGE_A_2}', 'A ganho', 'won', '${AGENT}', null, now()),
      ('b2840000-3000-4000-8000-000000000005', '${ORG_A}', '${PIPELINE_A}', '${STAGE_A_2}', 'A perdido', 'lost', '${OTHER_AGENT}', 'other', now()),
      ('b2840000-3000-4000-8000-000000000006', '${ORG_B}', '${PIPELINE_B}', '${STAGE_B}', 'B', 'open', '${OTHER_ORG_AGENT}', null, null)
    on conflict do nothing;
  `);
});

function compararComContagemAntiga(caso: Caso): { nova: string; antiga: string; outraOrg: string } {
  const claims = JSON.stringify({ sub: caso.userId }).replaceAll("'", "''");
  const ajustarModo = caso.visibilityMode
    ? `update public.organizations
         set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{visibility_mode}',
                                  to_jsonb('${caso.visibilityMode}'::text), true)
       where id = '${ORG_A}';`
    : "";

  const out = sql(`
    begin;
    ${ajustarModo}
    select set_config('request.jwt.claims', '${claims}', true);
    set local role authenticated;
    select 'nova:' || coalesce(jsonb_agg(jsonb_build_array(stage_id, total) order by stage_id)::text, '[]')
      from public.fn_contagem_por_etapa('${ORG_A}'::uuid, '${PIPELINE_A}'::uuid);
    select 'antiga:' || coalesce(jsonb_agg(jsonb_build_array(stage_id, total) order by stage_id)::text, '[]')
      from (
        select etapa.stage_id,
               (select count(*)::bigint
                  from public.crm_leads l
                 where l.organization_id = '${ORG_A}'::uuid
                   and l.pipeline_id = '${PIPELINE_A}'::uuid
                   and l.stage_id = etapa.stage_id
                   and l.status <> 'archived') as total
          from (values ('${STAGE_A_1}'::uuid), ('${STAGE_A_2}'::uuid)) etapa(stage_id)
      ) antiga
     where total > 0;
    select 'outra-org:' || coalesce(sum(total), 0)::text
      from public.fn_contagem_por_etapa('${ORG_B}'::uuid, '${PIPELINE_B}'::uuid);
    rollback;
  `);

  const valor = (prefixo: string) => {
    const linha = out.split("\n").find((item) => item.startsWith(prefixo));
    if (linha === undefined) throw new Error(`saída sem ${prefixo}: ${out}`);
    return linha.slice(prefixo.length);
  };
  return { nova: valor("nova:"), antiga: valor("antiga:"), outraOrg: valor("outra-org:") };
}

const casos: readonly Caso[] = [
  { nome: "viewer vê todas as etapas da própria organização", userId: VIEWER },
  { nome: "manager vê todas as etapas da própria organização", userId: MANAGER },
  { nome: "admin vê todas as etapas da própria organização", userId: ADMIN },
  {
    nome: "agent em all vê todos os negócios da organização",
    userId: AGENT,
    visibilityMode: "all",
  },
  {
    nome: "agent em own_and_unassigned vê próprios e sem dono",
    userId: AGENT,
    visibilityMode: "own_and_unassigned",
  },
  {
    nome: "agent em own vê somente os próprios",
    userId: AGENT,
    visibilityMode: "own",
  },
];

describe("0284 · contagem agrupada por etapa", () => {
  it.each(casos)("$nome e coincide exatamente com a contagem antiga", (caso) => {
    const resultado = compararComContagemAntiga(caso);
    expect(resultado.nova).toBe(resultado.antiga);
    expect(resultado.outraOrg).toBe("0");
  });

  it("não é executável por anon e usa SECURITY INVOKER estável", () => {
    expect(
      sql(`select has_function_privilege(
        'anon', 'public.fn_contagem_por_etapa(uuid,uuid)'::regprocedure, 'EXECUTE');`),
    ).toBe("f");
    expect(
      sql(`select p.prosecdef::text || '|' || p.provolatile
             from pg_proc p
            where p.oid = 'public.fn_contagem_por_etapa(uuid,uuid)'::regprocedure;`),
    ).toBe("false|s");
  });
});
