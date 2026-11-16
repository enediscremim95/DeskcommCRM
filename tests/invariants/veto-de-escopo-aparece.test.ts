import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { sincronizaEstagioDoAgente } from "@/lib/leads/agent-stage-sync";

import { pgComoSupabase } from "../pg-como-supabase";

/** Escopo de funil não autoriza IA a mover cards: política de 16/11/2026. */
const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)");
}

const PORT = Number(process.env.TEST_DB_PORT ?? 54329);
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`,
  max: 3,
});
const db = pgComoSupabase(pool);

const ORG = "7e707e00-0000-4000-8000-000000000001";
let contatoNoFunilDele = "";
let contatoNoFunilAlheio = "";
let funilDele = "";
let funilAlheio = "";

/** Um funil com duas etapas mapeadas para passos do agente. */
async function criarFunil(nome: string, slug: string): Promise<{ id: string; primeira: string }> {
  const { rows: p } = await pool.query<{ id: string }>(
    `insert into crm_pipelines (organization_id, name, slug, position) values ($1, $2, $3, 100) returning id`,
    [ORG, nome, slug],
  );
  const { rows: s1 } = await pool.query<{ id: string }>(
    `insert into crm_stages (organization_id, pipeline_id, name, slug, position, agent_stage_hint)
     values ($1, $2, 'Entrada', $3, 1, 'new') returning id`,
    [ORG, p[0]!.id, `entrada-${slug}`],
  );
  await pool.query(
    `insert into crm_stages (organization_id, pipeline_id, name, slug, position, agent_stage_hint)
     values ($1, $2, 'Qualificando', $3, 2, 'qualifying')`,
    [ORG, p[0]!.id, `qualif-${slug}`],
  );
  return { id: p[0]!.id, primeira: s1[0]!.id };
}

async function criarContatoComNegocio(nome: string, funil: { id: string; primeira: string }): Promise<string> {
  const { rows: c } = await pool.query<{ id: string }>(
    `insert into contacts (organization_id, display_name, source) values ($1, $2, 'whatsapp') returning id`,
    [ORG, nome],
  );
  await pool.query(
    `insert into crm_leads (organization_id, pipeline_id, stage_id, contact_id, title, status)
     values ($1, $2, $3, $4, $5, 'open')`,
    [ORG, funil.id, funil.primeira, c[0]!.id, `Negócio de ${nome}`],
  );
  return c[0]!.id;
}

beforeAll(async () => {
  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name)
     values ($1, 'org-veto-escopo', 'Veto LTDA', 'Veto') on conflict (id) do nothing`,
    [ORG],
  );
  const dele = await criarFunil("Suporte - IA", "suporte-ia");
  const alheio = await criarFunil("Comercial - Andrea", "comercial-andrea");
  funilDele = dele.id;
  funilAlheio = alheio.id;
  contatoNoFunilDele = await criarContatoComNegocio("Cliente do Suporte", dele);
  contatoNoFunilAlheio = await criarContatoComNegocio("Cliente da Andrea", alheio);
});

afterAll(async () => {
  await pool.query("delete from organizations where id = $1", [ORG]);
  await pool.end();
});

describe("nenhum escopo autoriza mudança automática de Kanban", () => {
  it("preserva etapa, status e updated_at no banco, com escopo autorizado, alheio, vazio e legado", async () => {
    const before = await pool.query("select id,stage_id,status,updated_at from crm_leads where organization_id=$1 order by id", [ORG]);
    for (const contactId of [contatoNoFunilDele, contatoNoFunilAlheio]) {
      for (const escopoDeFunis of [[funilDele], [funilAlheio], [], undefined]) {
        for (const passo of ["new", "qualifying", "won", "lost"]) {
          const result = await sincronizaEstagioDoAgente(db, { organizationId: ORG, contactId, passo, escopoDeFunis });
          expect(result).toEqual({ moveu: false, motivo: "decisao_humana_obrigatoria" });
        }
      }
    }
    const after = await pool.query("select id,stage_id,status,updated_at from crm_leads where organization_id=$1 order by id", [ORG]);
    expect(after.rows).toEqual(before.rows);
  });
});
