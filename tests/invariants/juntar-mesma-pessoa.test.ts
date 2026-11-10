import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GOV_AGENT_A, GOV_MANAGER, seedGov } from "./gov-helpers";

const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${process.env.TEST_DB_PORT ?? 54329}/postgres`,
  max: 4,
});

const ORG = randomUUID();
const OUTRA_ORG = randomUUID();
const SESSAO = randomUUID();
const FUNIL = randomUUID();
const ETAPA_INICIAL = randomUUID();
const ETAPA_AVANCADA = randomUUID();

async function comoGerente(statement: string, args: unknown[]) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: GOV_MANAGER, role: "authenticated", aal: "aal1" }),
    ]);
    const result = await client.query(statement, args);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function comoServico(statement: string, args: unknown[]) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role service_role");
    await client.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ role: "service_role" }),
    ]);
    const result = await client.query(statement, args);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function contatoFormulario(options: {
  nome: string;
  telefone: string;
  criadoEm?: Date;
  org?: string;
}) {
  const id = randomUUID();
  await pool.query(
    `insert into contacts(
       id,organization_id,name,display_name,phone_number,source,source_metadata,created_at
     ) values($1,$2,$3,$3,$4,'webhook','{}',$5)`,
    [id, options.org ?? ORG, options.nome, options.telefone, options.criadoEm ?? new Date()],
  );
  return id;
}

async function contatoWhatsapp(nome: string, telefone: string) {
  const id = randomUUID();
  await pool.query(
    `insert into contacts(
       id,organization_id,display_name,phone_number,source,source_metadata
     ) values($1,$2,$3,$4,'whatsapp','{"reconciliacao_formulario_pendente":true}')`,
    [id, ORG, nome, telefone],
  );
  return id;
}

async function primeiraMensagem(contato: string, texto: string, enviadaEm = new Date()) {
  const conversa = randomUUID();
  const externalId = `msg-${randomUUID()}`;
  await pool.query(
    `insert into conversations(
       id,organization_id,contact_id,channel_session_id,status,is_group
     ) values($1,$2,$3,$4,'open',false)`,
    [conversa, ORG, contato, SESSAO],
  );
  await pool.query(
    `insert into messages(
       organization_id,conversation_id,channel_session_id,contact_id,external_id,
       type,direction,status,body,sent_at
     ) values($1,$2,$3,$4,$5,'text','inbound','delivered',$6,$7)`,
    [ORG, conversa, SESSAO, contato, externalId, texto, enviadaEm],
  );
  return externalId;
}

async function reconciliar(contato: string, externalId: string) {
  const result = await pool.query<{ result: Record<string, unknown> }>(
    "select fn_reconciliar_contato_whatsapp_formulario($1,$2,$3,7) result",
    [ORG, contato, externalId],
  );
  return result.rows[0]!.result;
}

async function negocio(options: {
  contato: string;
  etapa?: string;
  origem?: Record<string, unknown>;
  campos?: Record<string, unknown>;
  tags?: string[];
  owner?: string | null;
  valor?: number | null;
  criadoEm?: Date;
}) {
  const id = randomUUID();
  await pool.query(
    `insert into crm_leads(
       id,organization_id,pipeline_id,stage_id,contact_id,title,status,source,
       source_metadata,custom_fields,tags,owner_user_id,value_cents,created_at,updated_at
     ) values($1,$2,$3,$4,$5,'Negócio do teste','open','webhook',$6,$7,$8,$9,$10,$11,$11)`,
    [
      id,
      ORG,
      FUNIL,
      options.etapa ?? ETAPA_INICIAL,
      options.contato,
      options.origem ?? {},
      options.campos ?? {},
      options.tags ?? [],
      options.owner ?? null,
      options.valor ?? null,
      options.criadoEm ?? new Date(),
    ],
  );
  return id;
}

beforeAll(async () => {
  seedGov();
  await pool.query(
    `insert into organizations(id,slug,legal_name,display_name) values
       ($1,$3,'Organização juntar pessoa','Organização juntar pessoa'),
       ($2,$4,'Organização vizinha','Organização vizinha')`,
    [ORG, OUTRA_ORG, `juntar-pessoa-${ORG.slice(0, 8)}`, `vizinha-${OUTRA_ORG.slice(0, 8)}`],
  );
  await pool.query(
    `insert into user_organizations(user_id,organization_id,role) values
       ($1,$2,'manager'),($3,$2,'agent')`,
    [GOV_MANAGER, ORG, GOV_AGENT_A],
  );
  await pool.query(
    `insert into channel_sessions(
       id,organization_id,waha_session_name,status,webhook_secret_encrypted
     ) values($1,$2,$3,'WORKING','\\x00')`,
    [SESSAO, ORG, `sessao-${SESSAO.slice(0, 8)}`],
  );
  await pool.query(
    `insert into crm_pipelines(id,organization_id,name,slug)
     values($1,$2,'Funil juntar pessoa',$3)`,
    [FUNIL, ORG, `funil-${FUNIL.slice(0, 8)}`],
  );
  await pool.query(
    `insert into crm_stages(id,organization_id,pipeline_id,name,slug,position) values
       ($1,$3,$4,'Entrada',$5,1000),
       ($2,$3,$4,'Avançada',$6,2000)`,
    [
      ETAPA_INICIAL,
      ETAPA_AVANCADA,
      ORG,
      FUNIL,
      `entrada-${ETAPA_INICIAL.slice(0, 8)}`,
      `avancada-${ETAPA_AVANCADA.slice(0, 8)}`,
    ],
  );
});

afterAll(async () => {
  await pool.query("delete from organizations where id=any($1::uuid[])", [[ORG, OUTRA_ORG]]);
  await pool.end();
});

describe("mesma pessoa por outro número", () => {
  it("junta Márcia pelo nome completo extraído da primeira mensagem", async () => {
    const enviadaEm = new Date();
    const form = await contatoFormulario({
      nome: "Márcia luz",
      telefone: "+5511959463107",
      criadoEm: new Date(enviadaEm.getTime() - 60_000),
    });
    const whatsapp = await contatoWhatsapp("Restrito 777", "+5511959851681");
    const externalId = await primeiraMensagem(
      whatsapp,
      "Olá! Me chamo Márcia luz e quero receber a apresentação da franquia Bendito Ponto.",
      enviadaEm,
    );

    const resultado = await reconciliar(whatsapp, externalId);
    expect(resultado).toMatchObject({
      outcome: "merged",
      form_contact_id: form,
      regra: "mensagem_pronta_nome_60_min",
    });
    const estado = await pool.query(
      `select f.is_merged_into,
              w.name,
              w.display_name,
              w.source_metadata->>'nome_perfil_whatsapp' as nome_perfil_whatsapp,
              q.resolution->'winner_before'->>'nome_perfil_whatsapp' as nome_perfil_no_snapshot
         from contacts f
         join contacts w on w.id = $2 and w.organization_id = $3
         join merge_queue q on q.id = $4 and q.organization_id = $3
        where f.id = $1 and f.organization_id = $3`,
      [form, whatsapp, ORG, resultado.merge_queue_id],
    );
    expect(estado.rows[0]).toEqual({
      is_merged_into: whatsapp,
      name: "Márcia luz",
      display_name: "Márcia luz",
      nome_perfil_whatsapp: "Restrito 777",
      nome_perfil_no_snapshot: "Restrito 777",
    });

    await comoGerente("select fn_desfazer_mesclagem_automatica_whatsapp($1,$2)", [
      ORG,
      resultado.merge_queue_id,
    ]);
    expect(
      (
        await pool.query(
          `select name,display_name,
                  source_metadata->>'nome_perfil_whatsapp' as nome_perfil_whatsapp
             from contacts where id=$1 and organization_id=$2`,
          [whatsapp, ORG],
        )
      ).rows[0],
    ).toEqual({
      name: null,
      display_name: "Restrito 777",
      nome_perfil_whatsapp: "Restrito 777",
    });
  });

  it("Ewerton com uma palavra vira sugestão, sem fusão", async () => {
    const enviadaEm = new Date();
    const form = await contatoFormulario({
      nome: "Ewerton",
      telefone: "+5541999990001",
      criadoEm: new Date(enviadaEm.getTime() - 60_000),
    });
    const whatsapp = await contatoWhatsapp("Contato WhatsApp", "+5541999999999");
    const externalId = await primeiraMensagem(
      whatsapp,
      "Oi, me chamo Ewerton e quero encomendar convite...",
      enviadaEm,
    );
    await expect(reconciliar(whatsapp, externalId)).resolves.toMatchObject({
      outcome: "suggestion",
      motivo: "nome_incompleto",
    });
    expect(
      (await pool.query("select is_merged_into from contacts where id=$1", [form])).rows[0]!
        .is_merged_into,
    ).toBeNull();
  });

  it("dois formulários com o mesmo nome viram uma sugestão", async () => {
    const enviadaEm = new Date();
    await contatoFormulario({
      nome: "Elaine Fatima Meiga",
      telefone: "+5515991503056",
      criadoEm: new Date(enviadaEm.getTime() - 60_000),
    });
    await contatoFormulario({
      nome: "Elaine Fatima Meiga",
      telefone: "+5515991503057",
      criadoEm: new Date(enviadaEm.getTime() - 120_000),
    });
    const whatsapp = await contatoWhatsapp("Elaine Meiga", "+551533460420");
    const externalId = await primeiraMensagem(
      whatsapp,
      "OLÁ! ME CHAMO Elaine Fatima Meiga E QUERO receber a apresentação.",
      enviadaEm,
    );
    await expect(reconciliar(whatsapp, externalId)).resolves.toMatchObject({
      outcome: "suggestion",
      motivo: "multiplos_candidatos",
    });
  });

  it("ignora formulário criado há mais de 60 minutos", async () => {
    const enviadaEm = new Date();
    await contatoFormulario({
      nome: "Pessoa Antiga",
      telefone: "+5511911110001",
      criadoEm: new Date(enviadaEm.getTime() - 61 * 60_000),
    });
    const whatsapp = await contatoWhatsapp("Outro nome", "+5511922220002");
    const externalId = await primeiraMensagem(
      whatsapp,
      "Olá, me chamo Pessoa Antiga e quero saber mais.",
      enviadaEm,
    );
    await expect(reconciliar(whatsapp, externalId)).resolves.toMatchObject({ outcome: "none" });
  });

  it("mantém a regra dos oito dígitos como primeira opção", async () => {
    const form = await contatoFormulario({ nome: "Rita", telefone: "+5541987654326" });
    const whatsapp = await contatoWhatsapp("Rita Alves", "+5521987654326");
    await expect(reconciliar(whatsapp, `sem-mensagem-${randomUUID()}`)).resolves.toMatchObject({
      outcome: "merged",
      form_contact_id: form,
      regra: "ultimos_8_digitos_7_dias_nome_compativel",
    });
  });

  it("não cruza candidatos de outra organização", async () => {
    const enviadaEm = new Date();
    await contatoFormulario({
      nome: "Vizinha Isolada",
      telefone: "+5511933330003",
      criadoEm: new Date(enviadaEm.getTime() - 60_000),
      org: OUTRA_ORG,
    });
    const whatsapp = await contatoWhatsapp("Restrito", "+5511944440004");
    const externalId = await primeiraMensagem(
      whatsapp,
      "Olá! Me chamo Vizinha Isolada e quero receber a apresentação.",
      enviadaEm,
    );
    await expect(reconciliar(whatsapp, externalId)).resolves.toMatchObject({ outcome: "none" });
    const leituraVizinha = await comoGerente(
      "select count(*)::int n from contacts where organization_id=$1 and name='Vizinha Isolada'",
      [OUTRA_ORG],
    );
    expect(leituraVizinha.rows[0]!.n).toBe(0);
  });
});

describe("junção contextual dos negócios da mesma pessoa", () => {
  it("preserva contexto, usa a etapa mais avançada e desfaz todo o estado combinado", async () => {
    const contato = await contatoFormulario({ nome: "Negócio Contextual", telefone: "+5511988881001" });
    const survivor = await negocio({
      contato,
      origem: { utm_source: "google", utm_medium: "cpc", utm_campaign: "franquia" },
      campos: { cidade: "Curitiba" },
      tags: ["formulario"],
      criadoEm: new Date(Date.now() - 120_000),
    });
    const absorbed = await negocio({
      contato,
      etapa: ETAPA_AVANCADA,
      origem: { utm_source: "meta", utm_medium: "paid", utm_campaign: "remarketing" },
      campos: { capital: "100000", cidade: "Não sobrescrever" },
      tags: ["whatsapp"],
      criadoEm: new Date(Date.now() - 60_000),
    });
    const activity = randomUUID();
    const task = randomUUID();
    await pool.query(
      `insert into crm_lead_activities(
         id,organization_id,lead_id,contact_id,source_module,type
       ) values($1,$2,$3,$4,'inbox','ai_turn')`,
      [activity, ORG, absorbed, contato],
    );
    await pool.query(
      `insert into crm_tasks(id,organization_id,title,lead_id)
       values($1,$2,'Retornar para a pessoa',$3)`,
      [task, ORG, absorbed],
    );

    const merged = await comoServico(
      "select fn_juntar_negocios_mesma_pessoa($1,$2,$3) result",
      [ORG, survivor, absorbed],
    );
    const result = merged.rows[0]!.result as { log_id: string };
    const state = await pool.query(
      `select stage_id,custom_fields,tags from crm_leads where id=$1`,
      [survivor],
    );
    expect(state.rows[0]).toMatchObject({
      stage_id: ETAPA_AVANCADA,
      custom_fields: { cidade: "Curitiba", capital: "100000" },
    });
    expect(state.rows[0]!.tags.sort()).toEqual(["formulario", "whatsapp"]);
    expect(
      (await pool.query("select count(*)::int n from crm_leads where id=$1", [absorbed])).rows[0]!.n,
    ).toBe(0);
    expect(
      (await pool.query("select lead_id from crm_lead_activities where id=$1", [activity])).rows[0]!
        .lead_id,
    ).toBe(survivor);
    expect((await pool.query("select lead_id from crm_tasks where id=$1", [task])).rows[0]!.lead_id).toBe(
      survivor,
    );
    const sourceActivity = await pool.query(
      `select reason from crm_lead_activities
        where lead_id=$1 and source_id=$2 and type='lead_source_preserved'`,
      [survivor, result.log_id],
    );
    expect(sourceActivity.rows[0]!.reason).toContain("origem meta/paid, campanha remarketing");

    await comoGerente("select fn_desfazer_juncao_de_negocios($1,$2)", [ORG, result.log_id]);
    const restored = await pool.query(
      `select id,stage_id,custom_fields,tags from crm_leads where id=any($1::uuid[]) order by id`,
      [[survivor, absorbed]],
    );
    expect(restored.rows).toHaveLength(2);
    const survivorRestored = restored.rows.find((row) => row.id === survivor)!;
    expect(survivorRestored).toMatchObject({
      stage_id: ETAPA_INICIAL,
      custom_fields: { cidade: "Curitiba" },
    });
    expect(survivorRestored.tags).toEqual(["formulario"]);
    expect(
      (await pool.query("select lead_id from crm_lead_activities where id=$1", [activity])).rows[0]!
        .lead_id,
    ).toBe(absorbed);
    expect((await pool.query("select lead_id from crm_tasks where id=$1", [task])).rows[0]!.lead_id).toBe(
      absorbed,
    );
  });

  it("recusa donos humanos diferentes", async () => {
    const contato = await contatoFormulario({ nome: "Donos Diferentes", telefone: "+5511988881002" });
    const survivor = await negocio({
      contato,
      origem: { source: "form" },
      owner: GOV_MANAGER,
      criadoEm: new Date(Date.now() - 120_000),
    });
    const absorbed = await negocio({ contato, owner: GOV_AGENT_A });
    await expect(
      comoServico("select fn_juntar_negocios_mesma_pessoa($1,$2,$3)", [ORG, survivor, absorbed]),
    ).rejects.toThrow("donos_humanos_diferentes");
  });

  it("simula o lote sem alterar contatos nem negócios", async () => {
    const enviadaEm = new Date();
    const formulario = await contatoFormulario({
      nome: "Plano Unico",
      telefone: "+5511988881003",
      criadoEm: new Date(enviadaEm.getTime() - 60_000),
    });
    const whatsapp = await contatoWhatsapp("Contato novo", "+5511977772004");
    await primeiraMensagem(
      whatsapp,
      "Olá, me chamo Plano Unico e quero receber a apresentação.",
      enviadaEm,
    );
    const survivor = await negocio({
      contato: formulario,
      origem: { source: "form" },
      criadoEm: new Date(Date.now() - 120_000),
    });
    const absorbed = await negocio({ contato: whatsapp, etapa: ETAPA_AVANCADA });
    const before = await pool.query(
      "select id,contact_id from crm_leads where id=any($1::uuid[]) order by id",
      [[survivor, absorbed]],
    );
    const simulation = await comoServico(
      "select fn_juntar_mesma_pessoa_da_organizacao($1,true) result",
      [ORG],
    );
    const after = await pool.query(
      "select id,contact_id from crm_leads where id=any($1::uuid[]) order by id",
      [[survivor, absorbed]],
    );
    expect(simulation.rows[0]!.result).toMatchObject({ simular: true });
    expect(simulation.rows[0]!.result.contatos).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          whatsapp_contact_id: whatsapp,
          acao: "juntar",
          regra: "mensagem_pronta_nome_60_min",
        }),
      ]),
    );
    expect(simulation.rows[0]!.result.negocios).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sobrevivente: survivor, absorvido: absorbed }),
      ]),
    );
    expect(after.rows).toEqual(before.rows);
    expect(
      (await pool.query("select is_merged_into from contacts where id=$1", [formulario])).rows[0]!
        .is_merged_into,
    ).toBeNull();
  });
});
