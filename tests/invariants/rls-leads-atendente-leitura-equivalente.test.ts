import { beforeAll, describe, expect, it } from "vitest";

import { sql } from "./gov-helpers";

/**
 * A 0290 antecipa os ramos conhecidos do atendente, mas fn_can_view_lead
 * continua sendo o oráculo do conjunto visível. Este teste cobre os três
 * modos, o padrão nulo, vínculo ausente ou revogado e a precedência do suporte.
 */

const ORG_ALL = "b2900000-0000-4000-8000-000000000001";
const ORG_SEM_DONO = "b2900000-0000-4000-8000-000000000002";
const ORG_PADRAO = "b2900000-0000-4000-8000-000000000003";
const ORG_PROPRIOS = "b2900000-0000-4000-8000-000000000004";
const ORG_SEM_PAPEL = "b2900000-0000-4000-8000-000000000005";
const ORG_REVOGADA = "b2900000-0000-4000-8000-000000000006";
const ORG_SUPORTE_ALVO = "b2900000-0000-4000-8000-000000000007";
const ORG_SUPORTE_OUTRA = "b2900000-0000-4000-8000-000000000008";

const AGENT = "b2900000-1000-4000-8000-000000000001";
const OTHER_AGENT = "b2900000-1000-4000-8000-000000000002";
const NO_ROLE_OWNER = "b2900000-1000-4000-8000-000000000003";
const REVOKED_OWNER = "b2900000-1000-4000-8000-000000000004";
const SUPPORT_AGENT = "b2900000-1000-4000-8000-000000000005";

const SUPPORT_SESSION = "b2900000-2000-4000-8000-000000000001";
const SUPPORT_ROW = "b2900000-2000-4000-8000-000000000002";

const PIPELINES = [
  "b2900000-3000-4000-8000-000000000001",
  "b2900000-3000-4000-8000-000000000002",
  "b2900000-3000-4000-8000-000000000003",
  "b2900000-3000-4000-8000-000000000004",
  "b2900000-3000-4000-8000-000000000005",
  "b2900000-3000-4000-8000-000000000006",
] as const;
const STAGES = [
  "b2900000-4000-4000-8000-000000000001",
  "b2900000-4000-4000-8000-000000000002",
  "b2900000-4000-4000-8000-000000000003",
  "b2900000-4000-4000-8000-000000000004",
  "b2900000-4000-4000-8000-000000000005",
  "b2900000-4000-4000-8000-000000000006",
] as const;

const LEAD_ALL_OWN = "b2900000-5000-4000-8000-000000000001";
const LEAD_ALL_OTHER = "b2900000-5000-4000-8000-000000000002";
const LEAD_ALL_FREE = "b2900000-5000-4000-8000-000000000003";
const LEAD_QUEUE_OWN = "b2900000-5000-4000-8000-000000000004";
const LEAD_QUEUE_OTHER = "b2900000-5000-4000-8000-000000000005";
const LEAD_QUEUE_FREE = "b2900000-5000-4000-8000-000000000006";
const LEAD_DEFAULT_OWN = "b2900000-5000-4000-8000-000000000007";
const LEAD_DEFAULT_OTHER = "b2900000-5000-4000-8000-000000000008";
const LEAD_DEFAULT_FREE = "b2900000-5000-4000-8000-000000000009";
const LEAD_OWN_OWN = "b2900000-5000-4000-8000-000000000010";
const LEAD_OWN_OTHER = "b2900000-5000-4000-8000-000000000011";
const LEAD_OWN_FREE = "b2900000-5000-4000-8000-000000000012";
const LEAD_NO_ROLE_OWN = "b2900000-5000-4000-8000-000000000013";
const LEAD_REVOKED_OWN = "b2900000-5000-4000-8000-000000000014";

const LEADS_DO_AGENT = [
  LEAD_ALL_OWN,
  LEAD_ALL_OTHER,
  LEAD_ALL_FREE,
  LEAD_QUEUE_OWN,
  LEAD_QUEUE_FREE,
  LEAD_DEFAULT_OWN,
  LEAD_DEFAULT_FREE,
  LEAD_OWN_OWN,
] as const;

interface Caso {
  readonly nome: string;
  readonly userId: string;
  readonly esperados: readonly string[];
}

beforeAll(() => {
  const usuarios = [AGENT, OTHER_AGENT, NO_ROLE_OWNER, REVOKED_OWNER, SUPPORT_AGENT];
  const organizacoes = [
    ORG_ALL,
    ORG_SEM_DONO,
    ORG_PADRAO,
    ORG_PROPRIOS,
    ORG_SEM_PAPEL,
    ORG_REVOGADA,
    ORG_SUPORTE_ALVO,
    ORG_SUPORTE_OUTRA,
  ];

  sql(`
    insert into auth.users (id, email)
    select id, 'rls-0290-' || ordinalidade || '@invariant.test'
      from unnest(array[${usuarios.map((id) => `'${id}'::uuid`).join(", ")}])
           with ordinality as u(id, ordinalidade)
    on conflict do nothing;

    insert into auth.sessions (id, user_id, aal) values
      ('${SUPPORT_SESSION}', '${SUPPORT_AGENT}', 'aal1')
    on conflict do nothing;

    insert into public.organizations (id, slug, legal_name, display_name, settings) values
      ('${ORG_ALL}', 'rls-0290-all', 'RLS 0290 all', 'RLS 0290 all',
       jsonb_build_object('visibility_mode', 'all')),
      ('${ORG_SEM_DONO}', 'rls-0290-queue', 'RLS 0290 queue', 'RLS 0290 queue',
       jsonb_build_object('visibility_mode', 'own_and_unassigned')),
      ('${ORG_PADRAO}', 'rls-0290-default', 'RLS 0290 default', 'RLS 0290 default', '{}'::jsonb),
      ('${ORG_PROPRIOS}', 'rls-0290-own', 'RLS 0290 own', 'RLS 0290 own',
       jsonb_build_object('visibility_mode', 'own')),
      ('${ORG_SEM_PAPEL}', 'rls-0290-no-role', 'RLS 0290 no role', 'RLS 0290 no role',
       jsonb_build_object('visibility_mode', 'all')),
      ('${ORG_REVOGADA}', 'rls-0290-revoked', 'RLS 0290 revoked', 'RLS 0290 revoked',
       jsonb_build_object('visibility_mode', 'all')),
      ('${ORG_SUPORTE_ALVO}', 'rls-0290-support-target', 'RLS 0290 support target',
       'RLS 0290 support target', jsonb_build_object('visibility_mode', 'all')),
      ('${ORG_SUPORTE_OUTRA}', 'rls-0290-support-other', 'RLS 0290 support other',
       'RLS 0290 support other', jsonb_build_object('visibility_mode', 'all'))
    on conflict (id) do update set settings = excluded.settings;

    insert into public.user_organizations
      (user_id, organization_id, role, accepted_at, revoked_at) values
      ('${AGENT}', '${ORG_ALL}', 'agent', now(), null),
      ('${AGENT}', '${ORG_SEM_DONO}', 'agent', now(), null),
      ('${AGENT}', '${ORG_PADRAO}', 'agent', now(), null),
      ('${AGENT}', '${ORG_PROPRIOS}', 'agent', now(), null),
      ('${REVOKED_OWNER}', '${ORG_REVOGADA}', 'agent', now(), now()),
      ('${SUPPORT_AGENT}', '${ORG_SUPORTE_ALVO}', 'agent', now(), null),
      ('${SUPPORT_AGENT}', '${ORG_SUPORTE_OUTRA}', 'agent', now(), null)
    on conflict do nothing;

    insert into public.platform_admins
      (user_id, granted_by, scope, mfa_required, reason) values
      ('${SUPPORT_AGENT}', '${SUPPORT_AGENT}', 'full', false, 'Invariante 0290')
    on conflict do nothing;

    insert into public.platform_support_sessions
      (id, organization_id, actor_user_id, auth_session_id, access_mode, expires_at) values
      ('${SUPPORT_ROW}', '${ORG_SUPORTE_ALVO}', '${SUPPORT_AGENT}', '${SUPPORT_SESSION}',
       'support_readonly', now() + interval '1 hour')
    on conflict (id) do update set
      organization_id = excluded.organization_id,
      actor_user_id = excluded.actor_user_id,
      auth_session_id = excluded.auth_session_id,
      access_mode = excluded.access_mode,
      expires_at = excluded.expires_at,
      ended_at = null;

    insert into public.crm_pipelines (id, organization_id, name, slug)
    select p.id, p.organization_id, p.name, p.slug
      from (values
        ('${PIPELINES[0]}'::uuid, '${organizacoes[0]}'::uuid, 'RLS 0290 all', 'rls-0290-all'),
        ('${PIPELINES[1]}'::uuid, '${organizacoes[1]}'::uuid, 'RLS 0290 queue', 'rls-0290-queue'),
        ('${PIPELINES[2]}'::uuid, '${organizacoes[2]}'::uuid, 'RLS 0290 default', 'rls-0290-default'),
        ('${PIPELINES[3]}'::uuid, '${organizacoes[3]}'::uuid, 'RLS 0290 own', 'rls-0290-own'),
        ('${PIPELINES[4]}'::uuid, '${organizacoes[4]}'::uuid, 'RLS 0290 no role', 'rls-0290-no-role'),
        ('${PIPELINES[5]}'::uuid, '${organizacoes[5]}'::uuid, 'RLS 0290 revoked', 'rls-0290-revoked')
      ) as p(id, organization_id, name, slug)
    on conflict do nothing;

    insert into public.crm_stages
      (id, organization_id, pipeline_id, name, slug, position)
    select s.id, s.organization_id, s.pipeline_id, 'Novo', 'novo', 1000
      from (values
        ('${STAGES[0]}'::uuid, '${organizacoes[0]}'::uuid, '${PIPELINES[0]}'::uuid),
        ('${STAGES[1]}'::uuid, '${organizacoes[1]}'::uuid, '${PIPELINES[1]}'::uuid),
        ('${STAGES[2]}'::uuid, '${organizacoes[2]}'::uuid, '${PIPELINES[2]}'::uuid),
        ('${STAGES[3]}'::uuid, '${organizacoes[3]}'::uuid, '${PIPELINES[3]}'::uuid),
        ('${STAGES[4]}'::uuid, '${organizacoes[4]}'::uuid, '${PIPELINES[4]}'::uuid),
        ('${STAGES[5]}'::uuid, '${organizacoes[5]}'::uuid, '${PIPELINES[5]}'::uuid)
      ) as s(id, organization_id, pipeline_id)
    on conflict do nothing;

    insert into public.crm_leads
      (id, organization_id, pipeline_id, stage_id, title, owner_user_id) values
      ('${LEAD_ALL_OWN}', '${ORG_ALL}', '${PIPELINES[0]}', '${STAGES[0]}', 'All próprio', '${AGENT}'),
      ('${LEAD_ALL_OTHER}', '${ORG_ALL}', '${PIPELINES[0]}', '${STAGES[0]}', 'All outro', '${OTHER_AGENT}'),
      ('${LEAD_ALL_FREE}', '${ORG_ALL}', '${PIPELINES[0]}', '${STAGES[0]}', 'All sem dono', null),
      ('${LEAD_QUEUE_OWN}', '${ORG_SEM_DONO}', '${PIPELINES[1]}', '${STAGES[1]}', 'Fila próprio', '${AGENT}'),
      ('${LEAD_QUEUE_OTHER}', '${ORG_SEM_DONO}', '${PIPELINES[1]}', '${STAGES[1]}', 'Fila outro', '${OTHER_AGENT}'),
      ('${LEAD_QUEUE_FREE}', '${ORG_SEM_DONO}', '${PIPELINES[1]}', '${STAGES[1]}', 'Fila sem dono', null),
      ('${LEAD_DEFAULT_OWN}', '${ORG_PADRAO}', '${PIPELINES[2]}', '${STAGES[2]}', 'Padrão próprio', '${AGENT}'),
      ('${LEAD_DEFAULT_OTHER}', '${ORG_PADRAO}', '${PIPELINES[2]}', '${STAGES[2]}', 'Padrão outro', '${OTHER_AGENT}'),
      ('${LEAD_DEFAULT_FREE}', '${ORG_PADRAO}', '${PIPELINES[2]}', '${STAGES[2]}', 'Padrão sem dono', null),
      ('${LEAD_OWN_OWN}', '${ORG_PROPRIOS}', '${PIPELINES[3]}', '${STAGES[3]}', 'Own próprio', '${AGENT}'),
      ('${LEAD_OWN_OTHER}', '${ORG_PROPRIOS}', '${PIPELINES[3]}', '${STAGES[3]}', 'Own outro', '${OTHER_AGENT}'),
      ('${LEAD_OWN_FREE}', '${ORG_PROPRIOS}', '${PIPELINES[3]}', '${STAGES[3]}', 'Own sem dono', null),
      ('${LEAD_NO_ROLE_OWN}', '${ORG_SEM_PAPEL}', '${PIPELINES[4]}', '${STAGES[4]}', 'Sem papel próprio', '${NO_ROLE_OWNER}'),
      ('${LEAD_REVOKED_OWN}', '${ORG_REVOGADA}', '${PIPELINES[5]}', '${STAGES[5]}', 'Revogado próprio', '${REVOKED_OWNER}')
    on conflict (id) do nothing;
  `);
});

function claims(userId: string, sessionId?: string): string {
  return JSON.stringify({
    sub: userId,
    ...(sessionId ? { session_id: sessionId, aal: "aal1" } : {}),
  }).replaceAll("'", "''");
}

function lerLista(out: string, prefixo: string): string[] {
  const linha = out.split("\n").find((item) => item.startsWith(prefixo));
  if (linha === undefined) throw new Error(`saída sem ${prefixo}: ${out}`);
  const ids = linha.slice(prefixo.length);
  return ids === "" ? [] : ids.split(",");
}

function conjuntosDoCaso(caso: Caso): { atual: string[]; antigo: string[] } {
  const out = sql(`
    begin;
    select set_config('request.jwt.claims', '${claims(caso.userId)}', true);
    set local role authenticated;
    select 'atual:' || coalesce(string_agg(id::text, ',' order by id), '')
      from public.crm_leads;
    reset role;
    select 'antigo:' || coalesce(string_agg(id::text, ',' order by id), '')
      from public.crm_leads
     where public.fn_can_view_lead(organization_id, owner_user_id);
    rollback;
  `);

  return { atual: lerLista(out, "atual:"), antigo: lerLista(out, "antigo:") };
}

function arraysDoCaso(userId: string, sessionId?: string) {
  const out = sql(`
    begin;
    select set_config('request.jwt.claims', '${claims(userId, sessionId)}', true);
    set local role authenticated;
    select 'total:' || coalesce(array_to_string(public.fn_orgs_atendente_leitura_total(), ','), '');
    select 'sem_dono:' || coalesce(array_to_string(public.fn_orgs_atendente_leitura_sem_dono(), ','), '');
    reset role;
    select 'oraculo_total:' || coalesce(string_agg(id::text, ',' order by id), '')
      from public.organizations
     where public.fn_user_role_in_org(id) = 'agent'
       and coalesce(settings->>'visibility_mode', 'own_and_unassigned') = 'all';
    select 'oraculo_sem_dono:' || coalesce(string_agg(id::text, ',' order by id), '')
      from public.organizations
     where public.fn_user_role_in_org(id) = 'agent'
       and coalesce(settings->>'visibility_mode', 'own_and_unassigned')
           in ('own_and_unassigned', 'all');
    rollback;
  `);

  return {
    total: lerLista(out, "total:"),
    semDono: lerLista(out, "sem_dono:"),
    oraculoTotal: lerLista(out, "oraculo_total:"),
    oraculoSemDono: lerLista(out, "oraculo_sem_dono:"),
  };
}

const casos: readonly Caso[] = [
  { nome: "agent nos quatro modos", userId: AGENT, esperados: LEADS_DO_AGENT },
  { nome: "dono sem papel na organização", userId: NO_ROLE_OWNER, esperados: [] },
  { nome: "dono com vínculo revogado", userId: REVOKED_OWNER, esperados: [] },
];

describe("RLS barata de crm_leads para atendentes", () => {
  it.each(casos)("$nome mantém exatamente o conjunto da função antiga", (caso) => {
    const { atual, antigo } = conjuntosDoCaso(caso);

    expect(atual).toEqual(antigo);
    expect(atual).toEqual([...caso.esperados].sort());
  });

  it("materializa all e own_and_unassigned, incluindo o padrão nulo", () => {
    const resultado = arraysDoCaso(AGENT);

    expect(resultado.total).toEqual(resultado.oraculoTotal);
    expect(resultado.semDono).toEqual(resultado.oraculoSemDono);
    expect(resultado.total).toEqual([ORG_ALL]);
    expect(resultado.semDono).toEqual([ORG_ALL, ORG_SEM_DONO, ORG_PADRAO].sort());
  });

  it("faz a sessão de suporte substituir o papel agent na organização-alvo", () => {
    const resultado = arraysDoCaso(SUPPORT_AGENT, SUPPORT_SESSION);

    expect(resultado.total).toEqual(resultado.oraculoTotal);
    expect(resultado.semDono).toEqual(resultado.oraculoSemDono);
    expect(resultado.total).toContain(ORG_SUPORTE_OUTRA);
    expect(resultado.total).not.toContain(ORG_SUPORTE_ALVO);
  });

  it("não expõe os auxiliares a public ou anon", () => {
    const out = sql(`
      select 'public_total:' || exists (
        select 1
          from pg_proc p,
               lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
         where p.oid = 'public.fn_orgs_atendente_leitura_total()'::regprocedure
           and acl.grantee = 0
           and acl.privilege_type = 'EXECUTE'
      );
      select 'anon_total:' || has_function_privilege('anon',
        'public.fn_orgs_atendente_leitura_total()', 'execute');
      select 'auth_total:' || has_function_privilege('authenticated',
        'public.fn_orgs_atendente_leitura_total()', 'execute');
      select 'public_sem_dono:' || exists (
        select 1
          from pg_proc p,
               lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
         where p.oid = 'public.fn_orgs_atendente_leitura_sem_dono()'::regprocedure
           and acl.grantee = 0
           and acl.privilege_type = 'EXECUTE'
      );
      select 'anon_sem_dono:' || has_function_privilege('anon',
        'public.fn_orgs_atendente_leitura_sem_dono()', 'execute');
      select 'auth_sem_dono:' || has_function_privilege('authenticated',
        'public.fn_orgs_atendente_leitura_sem_dono()', 'execute');
    `);

    expect(out).toContain("public_total:false");
    expect(out).toContain("anon_total:false");
    expect(out).toContain("auth_total:true");
    expect(out).toContain("public_sem_dono:false");
    expect(out).toContain("anon_sem_dono:false");
    expect(out).toContain("auth_sem_dono:true");
  });
});
