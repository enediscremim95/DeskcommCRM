import pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { GOV_ADMIN, GOV_ORG, seedGov } from "./gov-helpers";

const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${process.env.TEST_DB_PORT ?? 54329}/postgres`,
  max: 3,
});
const OUTRA_ORG = "11900000-0000-4000-8000-000000000001";
const AGENTE_PROPRIO = "11900000-0000-4000-8000-000000000002";
const AGENTE_ALHEIO = "11900000-0000-4000-8000-000000000003";

beforeAll(async () => {
  await seedGov();
  await pool.query("delete from ai_agents where id in($1,$2)", [AGENTE_PROPRIO, AGENTE_ALHEIO]);
  await pool.query("delete from organizations where id=$1", [OUTRA_ORG]);
  await pool.query(
    "insert into organizations(id,slug,legal_name,display_name) values($1::uuid,$1::text,'Outra organização','Outra organização')",
    [OUTRA_ORG],
  );
  const config = {
    reply_assistant: {
      managed: true,
      enabled: false,
      provider: "anthropic",
      model: "modelo",
      credential_id: "11900000-0000-4000-8000-000000000004",
      team_style: "Fale de forma curta e cordial.",
      history_message_window: 20,
      history_token_window: 4000,
      hourly_limit: 20,
      daily_limit: 100,
    },
  };
  await pool.query(
    `insert into ai_agents(id,organization_id,name,kind,operation_mode,paused_at,system_prompt,config)
     values($1,$2,'Assistente próprio','mcp_agent','assisted',now(),'Instrução do teste',$3),
           ($4,$5,'Assistente alheio','mcp_agent','assisted',now(),'Instrução do teste',$3)`,
    [AGENTE_PROPRIO, GOV_ORG, config, AGENTE_ALHEIO, OUTRA_ORG],
  );
});

afterAll(async () => {
  await pool.query("delete from ai_agents where id in($1,$2)", [AGENTE_PROPRIO, AGENTE_ALHEIO]);
  await pool.query("delete from organizations where id=$1", [OUTRA_ORG]);
  await pool.end();
});

async function como(userId: string | null, statement: string) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`set local role ${userId ? "authenticated" : "anon"}`);
    await client.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: userId, role: userId ? "authenticated" : "anon", aal: "aal2" }),
    ]);
    return await client.query(statement);
  } finally {
    try {
      await client.query("rollback");
    } finally {
      client.release();
    }
  }
}

it("RLS: a configuração interna não vaza entre organizações e anon não a lê", async () => {
  const own = await como(
    GOV_ADMIN,
    `select id from ai_agents where config @> '{"reply_assistant":{"managed":true}}'::jsonb order by id`,
  );
  expect(own.rows.map((row) => row.id)).toContain(AGENTE_PROPRIO);
  expect(own.rows.map((row) => row.id)).not.toContain(AGENTE_ALHEIO);
  await expect(
    como(
      null,
      `select id from ai_agents where id in('${AGENTE_PROPRIO}','${AGENTE_ALHEIO}')`,
    ),
  ).rejects.toMatchObject({ code: "42501" });
});

it("RLS: nem admin de outro tenant altera o assistente alheio", async () => {
  const result = await como(
    GOV_ADMIN,
    `update ai_agents set name='Não deve mudar' where id='${AGENTE_ALHEIO}' returning id`,
  );
  expect(result.rows).toEqual([]);
});

it("RPC: a exceção exige agente interno assistido, pausado, inativo e ligado", async () => {
  const { rows } = await pool.query<{ definition: string }>(
    `select pg_get_functiondef(
       'public.fn_reply_begin(uuid,uuid,uuid,uuid,uuid)'::regprocedure
     ) as definition`,
  );
  const definition = rows[0]?.definition ?? "";
  expect(definition).toMatch(/operation_mode\s*=\s*'assisted'/i);
  expect(definition).toMatch(/paused_at\s+is\s+not\s+null/i);
  expect(definition).toMatch(/not\s+a\.is_active/i);
  expect(definition).toContain("reply_assistant");
  expect(definition).toMatch(/active_ai_agent_id\s*<>\s*p_agent/i);
});

it("privilégios: fn_reply_begin continua exclusiva da service_role", async () => {
  const { rows } = await pool.query<{
    anon: boolean;
    authenticated: boolean;
    service_role: boolean;
  }>(`select
      has_function_privilege('anon','public.fn_reply_begin(uuid,uuid,uuid,uuid,uuid)','EXECUTE') as anon,
      has_function_privilege('authenticated','public.fn_reply_begin(uuid,uuid,uuid,uuid,uuid)','EXECUTE') as authenticated,
      has_function_privilege('service_role','public.fn_reply_begin(uuid,uuid,uuid,uuid,uuid)','EXECUTE') as service_role`);
  expect(rows[0]).toEqual({ anon: false, authenticated: false, service_role: true });
});
