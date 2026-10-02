import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set, rode via `pnpm test:db` (scripts/test-db.sh)");
}

const PORT = Number(process.env.TEST_DB_PORT ?? 54329);
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`,
  max: 3,
});

const ORG = "d0281000-0000-4000-8000-000000000001";
const OUTRA_ORG = "d0281000-0000-4000-8000-000000000002";
const SESSAO = "d0281000-0000-4000-8000-000000000003";
const FUNIL = "d0281000-0000-4000-8000-000000000004";
const ETAPA = "d0281000-0000-4000-8000-000000000005";

async function contatoFormulario(
  id: string,
  nome: string,
  telefone: string,
  org = ORG,
): Promise<string> {
  await pool.query(
    `insert into contacts (id, organization_id, name, phone_number, source, source_metadata)
     values ($1, $2, $3, $4, 'webhook', '{}'::jsonb)`,
    [id, org, nome, telefone],
  );
  return id;
}

async function contatoWhatsapp(id: string, nome: string, telefone: string): Promise<string> {
  await pool.query(
    `insert into contacts
       (id, organization_id, display_name, phone_number, source, source_metadata)
     values ($1, $2, $3, $4, 'whatsapp',
       '{"reconciliacao_formulario_pendente":true}'::jsonb)`,
    [id, ORG, nome, telefone],
  );
  return id;
}

async function reconciliar(whatsapp: string, mensagem: string) {
  const { rows } = await pool.query<{ r: Record<string, unknown> }>(
    "select public.fn_reconciliar_contato_whatsapp_formulario($1,$2,$3,7) as r",
    [ORG, whatsapp, mensagem],
  );
  return rows[0]!.r;
}

beforeAll(async () => {
  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name)
     values ($1, 'org-0281', 'Org 0281 LTDA', 'Org 0281'),
            ($2, 'outra-org-0281', 'Outra Org 0281 LTDA', 'Outra Org 0281')
     on conflict (id) do nothing`,
    [ORG, OUTRA_ORG],
  );
  await pool.query(
    `insert into channel_sessions
       (id, organization_id, waha_session_name, status, webhook_secret_encrypted)
     values ($1, $2, 'sessao-0281', 'WORKING', '\\x00'::bytea)
     on conflict (id) do nothing`,
    [SESSAO, ORG],
  );
  await pool.query(
    `insert into crm_pipelines (id, organization_id, name, slug)
     values ($1, $2, 'Funil 0281', 'funil-0281') on conflict (id) do nothing`,
    [FUNIL, ORG],
  );
  await pool.query(
    `insert into crm_stages (id, organization_id, pipeline_id, name, slug, position)
     values ($1, $2, $3, 'Entrada', 'entrada', 1) on conflict (id) do nothing`,
    [ETAPA, ORG, FUNIL],
  );
});

afterAll(async () => {
  await pool.query("delete from organizations where id in ($1, $2)", [ORG, OUTRA_ORG]);
  await pool.end();
});

describe("reconciliação formulário e WhatsApp", () => {
  it("junta Neuma com Neuma Brito, preserva o telefone informado e desfaz", async () => {
    const form = await contatoFormulario(
      "d0281100-0000-4000-8000-000000000001",
      "Neuma",
      "+552499876543",
    );
    const whatsapp = await contatoWhatsapp(
      "d0281100-0000-4000-8000-000000000002",
      "Neuma Brito",
      "+552199876543",
    );
    const lead = "d0281100-0000-4000-8000-000000000003";
    await pool.query(
      `insert into crm_leads (id, organization_id, pipeline_id, stage_id, title, contact_id, source)
       values ($1,$2,$3,$4,'Card da Neuma',$5,'webhook')`,
      [lead, ORG, FUNIL, ETAPA, form],
    );

    const resultado = await reconciliar(whatsapp, "mensagem-neuma-0281");
    expect(resultado).toMatchObject({ outcome: "merged", form_contact_id: form });

    const { rows: depois } = await pool.query<{
      lead_contact: string;
      merged_into: string;
      phone_number: string;
      original_phone: string;
    }>(
      `select l.contact_id as lead_contact, f.is_merged_into as merged_into,
              w.phone_number,
              w.source_metadata->'telefones_originais_formulario'->0->>'telefone' as original_phone
         from crm_leads l
         join contacts f on f.id = $1
         join contacts w on w.id = $2
        where l.id = $3`,
      [form, whatsapp, lead],
    );
    expect(depois[0]).toMatchObject({
      lead_contact: whatsapp,
      merged_into: whatsapp,
      phone_number: "+552199876543",
      original_phone: "+552499876543",
    });

    const { rows: rastro } = await pool.query<{
      juntado_por: string;
      regra: string;
      merged_at: string;
    }>(
      `select trigger_payload->>'juntado_por' as juntado_por,
              resolution->>'regra' as regra,
              resolution->>'merged_at' as merged_at
         from merge_queue where id = $1 and organization_id = $2`,
      [resultado.merge_queue_id, ORG],
    );
    expect(rastro[0]).toMatchObject({
      juntado_por: "sistema",
      regra: "ultimos_8_digitos_7_dias_nome_compativel",
    });
    expect(rastro[0]!.merged_at).toBeTruthy();

    const conversa = "d0281100-0000-4000-8000-000000000004";
    await pool.query(
      `insert into conversations
         (id, organization_id, contact_id, channel_session_id, status, is_group)
       values ($1,$2,$3,$4,'open',false)`,
      [conversa, ORG, whatsapp, SESSAO],
    );
    await pool.query("select public.fn_desfazer_mesclagem_automatica_whatsapp($1,$2)", [
      ORG,
      resultado.merge_queue_id,
    ]);

    const { rows: desfeito } = await pool.query<{
      lead_contact: string;
      merged_into: string | null;
      conversation_contact: string;
    }>(
      `select l.contact_id as lead_contact, f.is_merged_into as merged_into,
              cv.contact_id as conversation_contact
         from crm_leads l
         join contacts f on f.id = $1
         join conversations cv on cv.id = $2
        where l.id = $3`,
      [form, conversa, lead],
    );
    expect(desfeito[0]).toEqual({
      lead_contact: form,
      merged_into: null,
      conversation_contact: whatsapp,
    });
  });

  it("aceita uma letra de diferença entre Aha e Ana Batista", async () => {
    const form = await contatoFormulario(
      "d0281200-0000-4000-8000-000000000001",
      "Aha",
      "+5555987654321",
    );
    const whatsapp = await contatoWhatsapp(
      "d0281200-0000-4000-8000-000000000002",
      "Ana Batista",
      "+5521987654321",
    );
    await expect(reconciliar(whatsapp, "mensagem-ana-0281")).resolves.toMatchObject({
      outcome: "merged",
      form_contact_id: form,
    });
  });

  it("com dois candidatos não junta e registra revisão", async () => {
    const a = await contatoFormulario(
      "d0281300-0000-4000-8000-000000000001",
      "Carlos",
      "+5541987654322",
    );
    const b = await contatoFormulario(
      "d0281300-0000-4000-8000-000000000002",
      "Carlos",
      "+5551987654322",
    );
    const whatsapp = await contatoWhatsapp(
      "d0281300-0000-4000-8000-000000000003",
      "Carlos Silva",
      "+5521987654322",
    );
    const resultado = await reconciliar(whatsapp, "mensagem-multiplos-0281");
    expect(resultado).toMatchObject({ outcome: "suggestion", motivo: "multiplos_candidatos" });
    const { rows } = await pool.query<{ id: string; is_merged_into: string | null }>(
      "select id, is_merged_into from contacts where id = any($1) order by id",
      [[a, b]],
    );
    expect(rows.every((r) => r.is_merged_into === null)).toBe(true);
  });

  it("nome sem relação não junta e registra revisão", async () => {
    const form = await contatoFormulario(
      "d0281400-0000-4000-8000-000000000001",
      "Marcos",
      "+5541987654323",
    );
    const whatsapp = await contatoWhatsapp(
      "d0281400-0000-4000-8000-000000000002",
      "Juliana",
      "+5521987654323",
    );
    const resultado = await reconciliar(whatsapp, "mensagem-nome-0281");
    expect(resultado).toMatchObject({ outcome: "suggestion", motivo: "nome_incompativel" });
    const { rows } = await pool.query<{ is_merged_into: string | null }>(
      "select is_merged_into from contacts where id = $1",
      [form],
    );
    expect(rows[0]!.is_merged_into).toBeNull();
  });

  it("descarta candidato que já tem conversa", async () => {
    const form = await contatoFormulario(
      "d0281500-0000-4000-8000-000000000001",
      "Bianca",
      "+5541987654324",
    );
    await pool.query(
      `insert into conversations
         (id, organization_id, contact_id, channel_session_id, status, is_group)
       values ('d0281500-0000-4000-8000-000000000003',$1,$2,$3,'open',false)`,
      [ORG, form, SESSAO],
    );
    const whatsapp = await contatoWhatsapp(
      "d0281500-0000-4000-8000-000000000002",
      "Bianca Souza",
      "+5521987654324",
    );
    await expect(reconciliar(whatsapp, "mensagem-com-conversa-0281")).resolves.toMatchObject({
      outcome: "none",
    });
  });

  it("nunca considera candidato de outra organização", async () => {
    await contatoFormulario(
      "d0281600-0000-4000-8000-000000000001",
      "Paula",
      "+5541987654325",
      OUTRA_ORG,
    );
    const whatsapp = await contatoWhatsapp(
      "d0281600-0000-4000-8000-000000000002",
      "Paula Lima",
      "+5521987654325",
    );
    await expect(reconciliar(whatsapp, "mensagem-outra-org-0281")).resolves.toMatchObject({
      outcome: "none",
    });
  });

  it("a mesma mensagem duas vezes devolve o mesmo registro sem duplicar", async () => {
    await contatoFormulario("d0281700-0000-4000-8000-000000000001", "Rita", "+5541987654326");
    const whatsapp = await contatoWhatsapp(
      "d0281700-0000-4000-8000-000000000002",
      "Rita Alves",
      "+5521987654326",
    );
    const primeira = await reconciliar(whatsapp, "mensagem-idempotente-0281");
    const segunda = await reconciliar(whatsapp, "mensagem-idempotente-0281");
    expect(segunda.merge_queue_id).toBe(primeira.merge_queue_id);
    const { rows } = await pool.query<{ total: string }>(
      `select count(*)::text as total from merge_queue
        where organization_id = $1
          and trigger_payload->>'external_message_id' = 'mensagem-idempotente-0281'`,
      [ORG],
    );
    expect(rows[0]!.total).toBe("1");
  });
});
