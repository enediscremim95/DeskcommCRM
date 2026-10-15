import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set, rode via test:db");
}

const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${process.env.TEST_DB_PORT ?? 54329}/postgres`,
  max: 2,
});

const ORG = "28900000-0000-4000-8000-000000000001";
const CONTATO = "28900000-0000-4000-8000-000000000002";
const SESSAO = "28900000-0000-4000-8000-000000000003";
const CONVERSA = "28900000-0000-4000-8000-000000000004";
const MENSAGEM = "28900000-0000-4000-8000-000000000005";
const MENSAGEM_NORMAL = "28900000-0000-4000-8000-000000000006";

beforeAll(async () => {
  await pool.query(
    "insert into organizations(id,slug,legal_name,display_name) values($1,'hist-silencioso','Histórico','Histórico') on conflict(id) do nothing",
    [ORG],
  );
  await pool.query(
    "insert into contacts(id,organization_id,name,phone_number) values($1,$2,'Contato','+5511900000289') on conflict(id) do nothing",
    [CONTATO, ORG],
  );
  await pool.query(
    "insert into channel_sessions(id,organization_id,waha_session_name,status,webhook_secret_encrypted) values($1,$2,'hist-0289','WORKING','\\x00'::bytea) on conflict(id) do nothing",
    [SESSAO, ORG],
  );
  await pool.query(
    "insert into conversations(id,organization_id,contact_id,channel_session_id,status,is_group,metadata) values($1,$2,$3,$4,'open',false,'{\"historico\":true}') on conflict(id) do nothing",
    [CONVERSA, ORG, CONTATO, SESSAO],
  );
});

afterAll(() => pool.end());

describe("histórico não se apresenta como mensagem ao vivo", () => {
  it("não emite efeitos ao vivo nem invalida o contexto de resposta", async () => {
    const antes = await pool.query(
      "select reply_context_revision,status from conversations where organization_id=$1 and id=$2",
      [ORG, CONVERSA],
    );

    await pool.query(
      `insert into messages(id,organization_id,conversation_id,channel_session_id,contact_id,
        external_id,type,direction,status,body,sent_via,sent_at,metadata)
       values($1,$2,$3,$4,$5,'hist-ext-0289','text','inbound','delivered','mensagem antiga',
        'external_device',now()-interval '10 days','{"historico":true}')
       on conflict(id) do nothing`,
      [MENSAGEM, ORG, CONVERSA, SESSAO, CONTATO],
    );

    const eventos = await pool.query(
      "select count(*)::int n from event_log where organization_id=$1 and (entity_id=$2 or entity_id=$3)",
      [ORG, MENSAGEM, CONVERSA],
    );
    const conversa = await pool.query(
      "select current_demanda_id,assigned_to_user_id,reply_context_revision,status from conversations where organization_id=$1 and id=$2",
      [ORG, CONVERSA],
    );
    expect(eventos.rows[0].n).toBe(0);
    expect(conversa.rows[0].current_demanda_id).toBeNull();
    expect(conversa.rows[0].assigned_to_user_id).toBeNull();
    expect(conversa.rows[0].reply_context_revision).toBe(
      antes.rows[0].reply_context_revision,
    );

    await pool.query(
      "select public.fn_mark_historical_conversation_message($1,$2,'inbound','mensagem antiga',now()-interval '10 days')",
      [ORG, CONVERSA],
    );

    const depoisDoCarimbo = await pool.query(
      "select reply_context_revision,status from conversations where organization_id=$1 and id=$2",
      [ORG, CONVERSA],
    );
    expect(depoisDoCarimbo.rows[0].reply_context_revision).toBe(
      conversa.rows[0].reply_context_revision,
    );
    expect(depoisDoCarimbo.rows[0].status).toBe(conversa.rows[0].status);

    await pool.query(
      `insert into messages(id,organization_id,conversation_id,channel_session_id,contact_id,
        external_id,type,direction,status,body,sent_via,sent_at,metadata)
       values($1,$2,$3,$4,$5,'live-ext-0289','text','inbound','delivered','mensagem nova',
        'external_device',now(),'{}')
       on conflict(id) do nothing`,
      [MENSAGEM_NORMAL, ORG, CONVERSA, SESSAO, CONTATO],
    );

    const depoisDaMensagemNormal = await pool.query(
      "select reply_context_revision from conversations where organization_id=$1 and id=$2",
      [ORG, CONVERSA],
    );
    expect(Number(depoisDaMensagemNormal.rows[0].reply_context_revision)).toBeGreaterThan(
      Number(depoisDoCarimbo.rows[0].reply_context_revision),
    );
  });
});
