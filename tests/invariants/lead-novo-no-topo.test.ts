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
const USER_A = "02790000-0000-4000-8000-000000000005";
const ORG_B = "02790000-0000-4000-8000-000000000006";
const PIPELINE_B = "02790000-0000-4000-8000-000000000007";
const STAGE_B = "02790000-0000-4000-8000-000000000008";
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

async function reservarComoUsuario(
  organizationId: string,
  stageId: string,
  lado: "topo" | "fim" = "topo",
): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: USER_A, role: "authenticated", aal: "aal1" }),
    ]);
    const { rows } = await client.query<{ position: string }>(
      `select public.fn_reservar_posicao_lead_na_etapa($1, $2, $3)::text as position`,
      [organizationId, stageId, lado],
    );
    await client.query("commit");
    return Number(rows[0]!.position);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

beforeEach(async () => {
  await pool.query(
    `insert into public.organizations (id, slug, legal_name, display_name)
     values ($1, 'org-0279', 'Org 0279', 'Org 0279')
     on conflict (id) do nothing`,
    [ORG],
  );
  await pool.query(
    `insert into public.organizations (id, slug, legal_name, display_name)
     values ($1, 'org-0279-b', 'Org 0279 B', 'Org 0279 B')
     on conflict (id) do nothing`,
    [ORG_B],
  );
  await pool.query(
    `insert into auth.users (id, email)
     values ($1, 'user-a-0279@invariant.test')
     on conflict (id) do nothing`,
    [USER_A],
  );
  await pool.query(
    `insert into public.user_organizations (user_id, organization_id, role, accepted_at)
     values ($1, $2, 'agent', now())
     on conflict do nothing`,
    [USER_A, ORG],
  );
  await pool.query(
    `insert into public.crm_pipelines (id, organization_id, name, slug)
     values ($1, $2, 'Pipeline 0279', 'pipeline-0279')
     on conflict (id) do nothing`,
    [PIPELINE, ORG],
  );
  await pool.query(
    `insert into public.crm_pipelines (id, organization_id, name, slug)
     values ($1, $2, 'Pipeline 0279 B', 'pipeline-0279-b')
     on conflict (id) do nothing`,
    [PIPELINE_B, ORG_B],
  );
  await pool.query(
    `insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position)
     values
       ($1, $3, $4, 'Entrada', 'entrada-0279', 1000),
       ($2, $3, $4, 'Vazia', 'vazia-0279', 2000)
     on conflict (id) do nothing`,
    [STAGE, EMPTY_STAGE, ORG, PIPELINE],
  );
  await pool.query(
    `insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position)
     values ($1, $2, $3, 'Entrada B', 'entrada-0279-b', 1000)
     on conflict (id) do nothing`,
    [STAGE_B, ORG_B, PIPELINE_B],
  );

  await pool.query(`delete from public.crm_leads where organization_id in ($1, $2)`, [ORG, ORG_B]);
  await pool.query(
    `delete from public.crm_stage_position_reservations where organization_id in ($1, $2)`,
    [ORG, ORG_B],
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
    const positions = await Promise.all([
      reservarComoUsuario(ORG, STAGE),
      reservarComoUsuario(ORG, STAGE),
    ]);

    expect(new Set(positions).size).toBe(2);
    expect(positions.every((position) => position < 1000)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual([-1000, 0]);
  });

  it("usuário da organização reserva posição na própria etapa", async () => {
    await expect(reservarComoUsuario(ORG, STAGE)).resolves.toBe(0);
  });

  it("usuário da organização A não reserva posição para a organização B", async () => {
    await expect(reservarComoUsuario(ORG_B, STAGE_B)).rejects.toMatchObject({ code: "42501" });
  });

  it("usuário da organização A não alcança etapa de B usando o próprio escopo", async () => {
    await expect(reservarComoUsuario(ORG, STAGE_B)).rejects.toMatchObject({ code: "P0002" });
  });

  it("recusa reserva preexistente da etapa vinculada a outra organização", async () => {
    await pool.query(
      `insert into public.crm_stage_position_reservations (stage_id, organization_id)
       values ($1, $2)`,
      [STAGE, ORG_B],
    );

    await expect(reservarComoUsuario(ORG, STAGE)).rejects.toMatchObject({ code: "42501" });
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
