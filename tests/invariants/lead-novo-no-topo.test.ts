import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";

const port = process.env.TEST_DB_PORT;
if (!port) {
  throw new Error("TEST_DB_PORT não definido, rode via `pnpm test:db`.");
}

const pool = new Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`,
  max: 4,
});

const ORG = "02790000-0000-4000-8000-000000000001";
const PIPELINE = "02790000-0000-4000-8000-000000000002";
const STAGE = "02790000-0000-4000-8000-000000000003";
const EMPTY_STAGE = "02790000-0000-4000-8000-000000000004";
const EXISTING = [
  "02790000-0000-4000-8000-000000000101",
  "02790000-0000-4000-8000-000000000102",
  "02790000-0000-4000-8000-000000000103",
];

async function reservar(lado: "topo" | "fim"): Promise<number> {
  const { rows } = await pool.query<{ position: string }>(
    `select public.fn_reservar_posicao_lead_na_etapa($1, $2, $3)::text as position`,
    [ORG, STAGE, lado],
  );
  return Number(rows[0]!.position);
}

beforeEach(async () => {
  await pool.query(
    `
    insert into public.organizations (id, slug, legal_name, display_name)
    values ($1, 'org-0279', 'Org 0279', 'Org 0279')
    on conflict (id) do nothing;

    insert into public.crm_pipelines (id, organization_id, name, slug)
    values ($2, $1, 'Pipeline 0279', 'pipeline-0279')
    on conflict (id) do nothing;

    insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position)
    values
      ($3, $1, $2, 'Entrada', 'entrada-0279', 1000),
      ($4, $1, $2, 'Vazia', 'vazia-0279', 2000)
    on conflict (id) do nothing;
  `,
    [ORG, PIPELINE, STAGE, EMPTY_STAGE],
  );

  await pool.query(`delete from public.crm_leads where organization_id = $1`, [ORG]);
  await pool.query(
    `delete from public.crm_stage_position_reservations where organization_id = $1`,
    [ORG],
  );
  await pool.query(
    `insert into public.crm_leads
       (id, organization_id, pipeline_id, stage_id, title, position_in_stage)
     values
       ($1, $4, $5, $6, 'Primeiro existente', 1000),
       ($2, $4, $5, $6, 'Segundo existente', 2000),
       ($3, $4, $5, $6, 'Terceiro existente', 3000)`,
    [...EXISTING, ORG, PIPELINE, STAGE],
  );
});

afterAll(async () => {
  await pool.end();
});

describe("0279, reserva de posição do lead na etapa", () => {
  it("serializa duas chegadas simultâneas no topo sem posição repetida", async () => {
    const positions = await Promise.all([reservar("topo"), reservar("topo")]);

    expect(new Set(positions).size).toBe(2);
    expect(positions.every((position) => position < 1000)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual([-1000, 0]);
  });

  it("não altera a posição nem a ordem de quem já estava na coluna", async () => {
    await Promise.all([reservar("topo"), reservar("topo")]);

    const { rows } = await pool.query<{ id: string; position: string }>(
      `select id, position_in_stage::text as position
         from public.crm_leads
        where organization_id = $1 and stage_id = $2
        order by position_in_stage, id`,
      [ORG, STAGE],
    );

    expect(rows).toEqual([
      { id: EXISTING[0], position: "1000" },
      { id: EXISTING[1], position: "2000" },
      { id: EXISTING[2], position: "3000" },
    ]);
  });

  it("aceita posição negativa e mantém uma nova reserva acima da anterior", async () => {
    await reservar("topo");
    const second = await reservar("topo");
    const third = await reservar("topo");

    expect(second).toBe(-1000);
    expect(third).toBe(-2000);
  });

  it("mantém encerramentos no fim e usa 1000 numa etapa vazia", async () => {
    await expect(reservar("fim")).resolves.toBe(4000);

    const { rows } = await pool.query<{ position: string }>(
      `select public.fn_reservar_posicao_lead_na_etapa($1, $2, 'topo')::text as position`,
      [ORG, EMPTY_STAGE],
    );
    expect(Number(rows[0]!.position)).toBe(1000);
  });
});
