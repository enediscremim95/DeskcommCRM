import { beforeAll, describe, expect, it } from "vitest";

import { sql } from "./gov-helpers";

/**
 * A otimização da migration 0283 só é válida se a policy nova devolver o
 * mesmo conjunto que fn_can_view_lead aprovava antes. Cada caso abaixo lê a
 * tabela pela RLS como authenticated e compara com a tabela inteira lida como
 * postgres, filtrada pela função antiga sob o mesmo JWT.
 */

const ORG_A = "b2830000-0000-4000-8000-000000000001";
const ORG_B = "b2830000-0000-4000-8000-000000000002";
const PIPELINE_A = "b2830000-0000-4000-8000-000000000011";
const PIPELINE_B = "b2830000-0000-4000-8000-000000000012";
const STAGE_A = "b2830000-0000-4000-8000-000000000021";
const STAGE_B = "b2830000-0000-4000-8000-000000000022";

const PLATFORM_ADMIN = "b2830000-1000-4000-8000-000000000001";
const VIEWER = "b2830000-1000-4000-8000-000000000002";
const MANAGER = "b2830000-1000-4000-8000-000000000003";
const ADMIN = "b2830000-1000-4000-8000-000000000004";
const AGENT = "b2830000-1000-4000-8000-000000000005";
const OTHER_AGENT = "b2830000-1000-4000-8000-000000000006";
const REVOKED = "b2830000-1000-4000-8000-000000000007";
const OTHER_ORG_USER = "b2830000-1000-4000-8000-000000000008";
const NO_ORG_USER = "b2830000-1000-4000-8000-000000000009";
const SUPPORT_FULL = "b2830000-1000-4000-8000-000000000010";
const SUPPORT_READONLY = "b2830000-1000-4000-8000-000000000011";

const SESSION_FULL = "b2830000-2000-4000-8000-000000000001";
const SESSION_READONLY = "b2830000-2000-4000-8000-000000000002";
const SUPPORT_ROW_FULL = "b2830000-2000-4000-8000-000000000011";
const SUPPORT_ROW_READONLY = "b2830000-2000-4000-8000-000000000012";

const LEAD_A_OWN = "b2830000-3000-4000-8000-000000000001";
const LEAD_A_OTHER = "b2830000-3000-4000-8000-000000000002";
const LEAD_A_UNASSIGNED = "b2830000-3000-4000-8000-000000000003";
const LEAD_B_OWN = "b2830000-3000-4000-8000-000000000004";
const LEAD_B_UNASSIGNED = "b2830000-3000-4000-8000-000000000005";

const LEADS_A = [LEAD_A_OWN, LEAD_A_OTHER, LEAD_A_UNASSIGNED] as const;
const LEADS_B = [LEAD_B_OWN, LEAD_B_UNASSIGNED] as const;
const TODOS_OS_LEADS = [...LEADS_A, ...LEADS_B] as const;

interface Caso {
  readonly nome: string;
  readonly userId: string;
  readonly sessionId?: string;
  readonly visibilityMode?: "own_and_unassigned" | "all" | "own";
  readonly obrigatorios: readonly string[];
  readonly proibidos: readonly string[];
}

beforeAll(() => {
  const usuarios = [
    PLATFORM_ADMIN,
    VIEWER,
    MANAGER,
    ADMIN,
    AGENT,
    OTHER_AGENT,
    REVOKED,
    OTHER_ORG_USER,
    NO_ORG_USER,
    SUPPORT_FULL,
    SUPPORT_READONLY,
  ];

  sql(`
    insert into auth.users (id, email)
    select id, 'rls-0283-' || ordinalidade || '@invariant.test'
      from unnest(array[${usuarios.map((id) => `'${id}'::uuid`).join(", ")}])
           with ordinality as u(id, ordinalidade)
    on conflict do nothing;

    insert into auth.sessions (id, user_id, aal) values
      ('${SESSION_FULL}', '${SUPPORT_FULL}', 'aal1'),
      ('${SESSION_READONLY}', '${SUPPORT_READONLY}', 'aal1')
    on conflict do nothing;

    insert into public.organizations (id, slug, legal_name, display_name, settings) values
      ('${ORG_A}', 'rls-0283-a', 'RLS 0283 A', 'RLS 0283 A',
       jsonb_build_object('visibility_mode', 'own_and_unassigned')),
      ('${ORG_B}', 'rls-0283-b', 'RLS 0283 B', 'RLS 0283 B',
       jsonb_build_object('visibility_mode', 'own_and_unassigned'))
    on conflict do nothing;

    insert into public.user_organizations
      (user_id, organization_id, role, accepted_at, revoked_at) values
      ('${VIEWER}', '${ORG_A}', 'viewer', now(), null),
      ('${MANAGER}', '${ORG_A}', 'manager', now(), null),
      ('${ADMIN}', '${ORG_A}', 'admin', now(), null),
      ('${AGENT}', '${ORG_A}', 'agent', now(), null),
      ('${OTHER_AGENT}', '${ORG_A}', 'agent', now(), null),
      ('${REVOKED}', '${ORG_A}', 'admin', now(), now()),
      ('${OTHER_ORG_USER}', '${ORG_B}', 'agent', now(), null)
    on conflict do nothing;

    insert into public.platform_admins
      (user_id, granted_by, scope, mfa_required, reason) values
      ('${PLATFORM_ADMIN}', '${PLATFORM_ADMIN}', 'full', false, 'Invariante 0283'),
      ('${SUPPORT_FULL}', '${SUPPORT_FULL}', 'full', false, 'Invariante 0283'),
      ('${SUPPORT_READONLY}', '${SUPPORT_READONLY}', 'full', false, 'Invariante 0283')
    on conflict do nothing;

    insert into public.platform_support_sessions
      (id, organization_id, actor_user_id, auth_session_id, access_mode, expires_at) values
      ('${SUPPORT_ROW_FULL}', '${ORG_B}', '${SUPPORT_FULL}', '${SESSION_FULL}',
       'full', now() + interval '1 hour'),
      ('${SUPPORT_ROW_READONLY}', '${ORG_B}', '${SUPPORT_READONLY}', '${SESSION_READONLY}',
       'support_readonly', now() + interval '1 hour')
    on conflict (id) do update set
      organization_id = excluded.organization_id,
      actor_user_id = excluded.actor_user_id,
      auth_session_id = excluded.auth_session_id,
      access_mode = excluded.access_mode,
      expires_at = excluded.expires_at,
      ended_at = null;

    insert into public.crm_pipelines (id, organization_id, name, slug) values
      ('${PIPELINE_A}', '${ORG_A}', 'RLS 0283 A', 'rls-0283-a'),
      ('${PIPELINE_B}', '${ORG_B}', 'RLS 0283 B', 'rls-0283-b')
    on conflict do nothing;
    insert into public.crm_stages
      (id, organization_id, pipeline_id, name, slug, position) values
      ('${STAGE_A}', '${ORG_A}', '${PIPELINE_A}', 'Novo', 'novo', 1000),
      ('${STAGE_B}', '${ORG_B}', '${PIPELINE_B}', 'Novo', 'novo', 1000)
    on conflict do nothing;
    insert into public.crm_leads
      (id, organization_id, pipeline_id, stage_id, title, owner_user_id) values
      ('${LEAD_A_OWN}', '${ORG_A}', '${PIPELINE_A}', '${STAGE_A}', 'A do agente', '${AGENT}'),
      ('${LEAD_A_OTHER}', '${ORG_A}', '${PIPELINE_A}', '${STAGE_A}', 'A de outro', '${OTHER_AGENT}'),
      ('${LEAD_A_UNASSIGNED}', '${ORG_A}', '${PIPELINE_A}', '${STAGE_A}', 'A sem dono', null),
      ('${LEAD_B_OWN}', '${ORG_B}', '${PIPELINE_B}', '${STAGE_B}', 'B do agente', '${OTHER_ORG_USER}'),
      ('${LEAD_B_UNASSIGNED}', '${ORG_B}', '${PIPELINE_B}', '${STAGE_B}', 'B sem dono', null)
    on conflict (id) do nothing;
  `);
});

function conjuntosDoCaso(caso: Caso): { atual: string[]; antigo: string[] } {
  const claims = JSON.stringify({
    sub: caso.userId,
    ...(caso.sessionId ? { session_id: caso.sessionId, aal: "aal1" } : {}),
  }).replaceAll("'", "''");
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
    select 'atual:' || coalesce(string_agg(id::text, ',' order by id), '')
      from public.crm_leads;
    reset role;
    select 'antigo:' || coalesce(string_agg(id::text, ',' order by id), '')
      from public.crm_leads
     where public.fn_can_view_lead(organization_id, owner_user_id);
    rollback;
  `);

  const ler = (prefixo: string) => {
    const linha = out.split("\n").find((item) => item.startsWith(prefixo));
    if (linha === undefined) throw new Error(`saída sem ${prefixo}: ${out}`);
    const ids = linha.slice(prefixo.length);
    return ids === "" ? [] : ids.split(",");
  };

  return { atual: ler("atual:"), antigo: ler("antigo:") };
}

function organizacoesTotaisDoCaso(caso: Caso): { auxiliar: string[]; antiga: string[] } {
  const claims = JSON.stringify({
    sub: caso.userId,
    ...(caso.sessionId ? { session_id: caso.sessionId, aal: "aal1" } : {}),
  }).replaceAll("'", "''");
  const out = sql(`
    begin;
    select set_config('request.jwt.claims', '${claims}', true);
    set local role authenticated;
    select 'auxiliar:' || coalesce(array_to_string(public.fn_orgs_leitura_total(), ','), '');
    reset role;
    select 'antiga:' || coalesce(string_agg(id::text, ',' order by id), '')
      from public.organizations
     where public.fn_user_role_in_org(id) in ('viewer', 'manager', 'admin');
    rollback;
  `);

  const ler = (prefixo: string) => {
    const linha = out.split("\n").find((item) => item.startsWith(prefixo));
    if (linha === undefined) throw new Error(`saída sem ${prefixo}: ${out}`);
    const ids = linha.slice(prefixo.length);
    return ids === "" ? [] : ids.split(",");
  };

  return { auxiliar: ler("auxiliar:"), antiga: ler("antiga:") };
}

const casos: readonly Caso[] = [
  {
    nome: "administrador da plataforma",
    userId: PLATFORM_ADMIN,
    obrigatorios: TODOS_OS_LEADS,
    proibidos: [],
  },
  {
    nome: "viewer da organização A",
    userId: VIEWER,
    obrigatorios: LEADS_A,
    proibidos: LEADS_B,
  },
  {
    nome: "manager da organização A",
    userId: MANAGER,
    obrigatorios: LEADS_A,
    proibidos: LEADS_B,
  },
  {
    nome: "admin da organização A",
    userId: ADMIN,
    obrigatorios: LEADS_A,
    proibidos: LEADS_B,
  },
  {
    nome: "agent em own_and_unassigned",
    userId: AGENT,
    visibilityMode: "own_and_unassigned",
    obrigatorios: [LEAD_A_OWN, LEAD_A_UNASSIGNED],
    proibidos: [LEAD_A_OTHER, ...LEADS_B],
  },
  {
    nome: "agent em all",
    userId: AGENT,
    visibilityMode: "all",
    obrigatorios: LEADS_A,
    proibidos: LEADS_B,
  },
  {
    nome: "agent em outro valor",
    userId: AGENT,
    visibilityMode: "own",
    obrigatorios: [LEAD_A_OWN],
    proibidos: [LEAD_A_OTHER, LEAD_A_UNASSIGNED, ...LEADS_B],
  },
  {
    nome: "membro revogado",
    userId: REVOKED,
    obrigatorios: [],
    proibidos: TODOS_OS_LEADS,
  },
  {
    nome: "usuário somente da organização B",
    userId: OTHER_ORG_USER,
    obrigatorios: LEADS_B,
    proibidos: LEADS_A,
  },
  {
    nome: "usuário sem organização",
    userId: NO_ORG_USER,
    obrigatorios: [],
    proibidos: TODOS_OS_LEADS,
  },
  {
    nome: "sessão de suporte full ativa",
    userId: SUPPORT_FULL,
    sessionId: SESSION_FULL,
    obrigatorios: TODOS_OS_LEADS,
    proibidos: [],
  },
  {
    nome: "sessão de suporte readonly ativa",
    userId: SUPPORT_READONLY,
    sessionId: SESSION_READONLY,
    obrigatorios: TODOS_OS_LEADS,
    proibidos: [],
  },
];

describe("RLS de crm_leads otimizada mantém a função antiga como oráculo", () => {
  it.each(casos)("$nome devolve exatamente o mesmo conjunto", (caso) => {
    const { atual, antigo } = conjuntosDoCaso(caso);

    expect(atual).toEqual(antigo);
    for (const id of caso.obrigatorios) expect(atual).toContain(id);
    for (const id of caso.proibidos) expect(atual).not.toContain(id);
  });

  it.each(casos.filter((caso) => caso.sessionId !== undefined))(
    "$nome mantém a precedência de fn_user_role_in_org na função auxiliar",
    (caso) => {
      const { auxiliar, antiga } = organizacoesTotaisDoCaso(caso);

      expect(auxiliar).toEqual(antiga);
      expect(auxiliar).toContain(ORG_B);
    },
  );
});
