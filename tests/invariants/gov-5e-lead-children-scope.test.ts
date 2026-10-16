import { beforeAll, describe, expect, it } from "vitest";

import {
  GOV_AGENT_A,
  GOV_AGENT_B,
  GOV_MANAGER,
  GOV_ORG,
  GOV_PIPELINE,
  GOV_STAGE,
  GOV_VIEWER,
  countAs,
  seedGov,
  sql,
  writeCountAs,
} from "./gov-helpers";

/**
 * Eixo 5 / INB-10 (fecha em G6-00, migration 0042) — a timeline (crm_lead_activities)
 * e os vínculos (crm_lead_links) de um lead HERDAM a visibilidade do lead-pai. Antes
 * seguiam org-flat no SELECT: um agent em modo 'own' NÃO via o lead (fechado em G4-03,
 * 0036) mas lia as activities/links dele por query direta. Pré-condição da exposição
 * MCP (G6-03).
 *
 * A RLS nova aplica a MESMA fn_can_view_lead (0036) por EXISTS no lead_id — a
 * activity/link é visível SSE o lead-pai é visível. NÃO scalar-subquery de owner
 * (lição G4-01: scalar devolveria NULL pro lead oculto e own_and_unassigned trataria
 * NULL como "fila" ⇒ vazamento; o EXISTS fecha).
 *
 * Fixtures locais (namespace a5e… — exclusivo deste arquivo). GOV_ORG está no default
 * 'own_and_unassigned' (G1-06a): dois leads COM dono (A e B) — B é invisível ao agent A
 * (nenhum é a fila). Sem PII (LGPD): títulos/payloads sintéticos.
 */

const LEAD_A = "a5e01111-0000-4000-8000-000000000001"; // owner = GOV_AGENT_A
const LEAD_B = "a5e01111-0000-4000-8000-000000000002"; // owner = GOV_AGENT_B
const LEAD_SHARED = "a5e01111-0000-4000-8000-000000000003"; // sem dono, visível aos dois agents
const ACT_A = "a5e02222-0000-4000-8000-000000000001"; // activity do lead de A
const ACT_B = "a5e02222-0000-4000-8000-000000000002"; // activity do lead de B
const ACT_SYSTEM = "a5e02222-0000-4000-8000-000000000003";
const NOTE_AUTHOR_DELETE = "a5e02222-0000-4000-8000-000000000004";
const NOTE_OTHER_BLOCKED = "a5e02222-0000-4000-8000-000000000005";
const NOTE_MANAGER_DELETE = "a5e02222-0000-4000-8000-000000000006";
const LINK_A = "a5e03333-0000-4000-8000-000000000001"; // link do lead de A
const LINK_B = "a5e03333-0000-4000-8000-000000000002"; // link do lead de B
// target_id sintético (kind='external' — sem FK, não precisa existir).
const TARGET = "a5e04444-0000-4000-8000-000000000001";

beforeAll(() => {
  seedGov(); // GOV_ORG (default own_and_unassigned) + agents A/B + manager + pipeline/stage
  sql(`
    insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, title, owner_user_id)
      values
        ('${LEAD_A}', '${GOV_ORG}', '${GOV_PIPELINE}', '${GOV_STAGE}', 'Lead do agent A (5e)', '${GOV_AGENT_A}'),
        ('${LEAD_B}', '${GOV_ORG}', '${GOV_PIPELINE}', '${GOV_STAGE}', 'Lead do agent B (5e)', '${GOV_AGENT_B}'),
        ('${LEAD_SHARED}', '${GOV_ORG}', '${GOV_PIPELINE}', '${GOV_STAGE}', 'Lead compartilhado (5e)', null)
      on conflict (id) do nothing;

    insert into public.crm_lead_activities
      (id, organization_id, lead_id, source_module, type, payload, actor_kind, performed_by_user_id)
      values
        ('${ACT_A}', '${GOV_ORG}', '${LEAD_A}', 'invariant', 'note', '{"text":"sintetico A"}'::jsonb, 'user', '${GOV_AGENT_A}'),
        ('${ACT_B}', '${GOV_ORG}', '${LEAD_B}', 'invariant', 'note', '{"text":"sintetico B"}'::jsonb, 'user', '${GOV_AGENT_B}'),
        ('${ACT_SYSTEM}', '${GOV_ORG}', '${LEAD_SHARED}', 'invariant', 'system', '{}'::jsonb, 'system', null),
        ('${NOTE_AUTHOR_DELETE}', '${GOV_ORG}', '${LEAD_SHARED}', 'invariant', 'note', '{"text":"autor apaga"}'::jsonb, 'user', '${GOV_AGENT_A}'),
        ('${NOTE_OTHER_BLOCKED}', '${GOV_ORG}', '${LEAD_SHARED}', 'invariant', 'note', '{"text":"outro nao apaga"}'::jsonb, 'user', '${GOV_AGENT_A}'),
        ('${NOTE_MANAGER_DELETE}', '${GOV_ORG}', '${LEAD_SHARED}', 'invariant', 'note', '{"text":"gerente apaga"}'::jsonb, 'user', '${GOV_AGENT_A}')
      on conflict (id) do nothing;

    insert into public.crm_lead_links (id, organization_id, lead_id, target_kind, target_id, link_kind)
      values
        ('${LINK_A}', '${GOV_ORG}', '${LEAD_A}', 'external', '${TARGET}', 'reference'),
        ('${LINK_B}', '${GOV_ORG}', '${LEAD_B}', 'external', '${TARGET}', 'reference')
      on conflict (id) do nothing;
  `);
});

describe("eixo 5 / INB-10 — escopo da timeline/vínculos de lead (G6-00)", () => {
  // ---- READ: fechamento do vazamento ----
  it("agent A NÃO lê a activity de lead de outro agent (INB-10 = 0 rows)", () => {
    expect(
      countAs(
        GOV_AGENT_A,
        `select count(*) from public.crm_lead_activities where id = '${ACT_B}';`,
      ),
    ).toBe(0);
  });

  it("agent A NÃO lê o link de lead de outro agent (INB-10 = 0 rows)", () => {
    expect(
      countAs(GOV_AGENT_A, `select count(*) from public.crm_lead_links where id = '${LINK_B}';`),
    ).toBe(0);
  });

  // ---- READ: controle positivo (dono do lead vê a própria timeline) ----
  it("agent A lê a activity do PRÓPRIO lead (controle positivo = 1)", () => {
    expect(
      countAs(
        GOV_AGENT_A,
        `select count(*) from public.crm_lead_activities where id = '${ACT_A}';`,
      ),
    ).toBe(1);
  });

  it("agent A lê o link do PRÓPRIO lead (controle positivo = 1)", () => {
    expect(
      countAs(GOV_AGENT_A, `select count(*) from public.crm_lead_links where id = '${LINK_A}';`),
    ).toBe(1);
  });

  // ---- READ: manager org-wide (não-regressão — timeline continua funcionando) ----
  it("manager lê TODAS as activities da org (org-wide = 2)", () => {
    expect(
      countAs(
        GOV_MANAGER,
        `select count(*) from public.crm_lead_activities where id in ('${ACT_A}', '${ACT_B}');`,
      ),
    ).toBe(2);
  });

  it("manager lê TODOS os links da org (org-wide = 2)", () => {
    expect(
      countAs(
        GOV_MANAGER,
        `select count(*) from public.crm_lead_links where id in ('${LINK_A}', '${LINK_B}');`,
      ),
    ).toBe(2);
  });

  it("viewer lê atividade comum, mas não lê anotação", () => {
    expect(
      countAs(
        GOV_VIEWER,
        `select count(*) from public.crm_lead_activities where id in ('${ACT_SYSTEM}', '${NOTE_OTHER_BLOCKED}');`,
      ),
    ).toBe(1);
  });

  // ---- WRITE: a gravação legítima da timeline NÃO quebrou ----
  it("service role INSERE activity de qualquer lead (worker/IA/timeline automática não quebra)", () => {
    // Espelha o admin client (bypassrls) — o caminho real de todo escritor de timeline.
    const out = sql(`
      set role service_role;
      with w as (
        insert into public.crm_lead_activities (organization_id, lead_id, source_module, type)
          values ('${GOV_ORG}', '${LEAD_B}', 'invariant', 'system') returning 1
      ) select count(*) from w;
    `);
    expect(out.trim().split("\n").pop()).toBe("1");
  });

  it("agent A INSERE activity manual no PRÓPRIO lead (painel do lead não quebra)", () => {
    const out = sql(`
      set role authenticated;
      select set_config('request.jwt.claims', '{"sub":"${GOV_AGENT_A}"}', false);
      with w as (
        insert into public.crm_lead_activities
          (organization_id, lead_id, source_module, type, payload, actor_kind, performed_by_user_id)
          values (
            '${GOV_ORG}', '${LEAD_A}', 'invariant', 'note', '{"text":"nota manual"}'::jsonb,
            'user', '${GOV_AGENT_A}'
          ) returning 1
      ) select count(*) from w;
    `);
    expect(out.trim().split("\n").pop()).toBe("1");
  });

  it("autor APAGA a própria anotação", () => {
    expect(
      writeCountAs(
        GOV_AGENT_A,
        `delete from public.crm_lead_activities where id = '${NOTE_AUTHOR_DELETE}'`,
      ),
    ).toBe(1);
  });

  it("outro agent NÃO APAGA a anotação mesmo vendo o lead", () => {
    expect(
      countAs(
        GOV_AGENT_B,
        `select count(*) from public.crm_lead_activities where id = '${NOTE_OTHER_BLOCKED}';`,
      ),
    ).toBe(1);
    expect(
      writeCountAs(
        GOV_AGENT_B,
        `delete from public.crm_lead_activities where id = '${NOTE_OTHER_BLOCKED}'`,
      ),
    ).toBe(0);
  });

  it("manager APAGA a anotação de outro autor", () => {
    expect(
      writeCountAs(
        GOV_MANAGER,
        `delete from public.crm_lead_activities where id = '${NOTE_MANAGER_DELETE}'`,
      ),
    ).toBe(1);
  });
});
