import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  GOV_AGENT_A,
  GOV_MANAGER,
  GOV_ORG,
  GOV_PIPELINE,
  GOV_STAGE,
  seedGov,
} from "./gov-helpers";

const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${process.env.TEST_DB_PORT ?? 54329}/postgres`,
  max: 4,
});

const ORG_VIZINHA = randomUUID();
const FUNIL_ALTERNATIVO = randomUUID();
const ETAPA_ALTERNATIVA = randomUUID();
const FUNIL_VIZINHO = randomUUID();
const ETAPA_VIZINHA = randomUUID();

interface Par {
  contact: string;
  survivor: string;
  absorbed: string;
}

async function comoUsuario(user: string, statement: string, args: unknown[]) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: user, role: "authenticated", aal: "aal1" }),
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

async function contato(org = GOV_ORG) {
  const id = randomUUID();
  await pool.query(
    "insert into contacts(id,organization_id,display_name) values($1,$2,'Contato duplicado')",
    [id, org],
  );
  return id;
}

async function negocio(options: {
  contact: string;
  org?: string;
  pipeline?: string;
  stage?: string;
  title?: string;
  value?: number | null;
  customFields?: Record<string, unknown>;
  sourceMetadata?: Record<string, unknown>;
  status?: "open" | "won";
}) {
  const id = randomUUID();
  const status = options.status ?? "open";
  await pool.query(
    `insert into crm_leads(
       id,organization_id,pipeline_id,stage_id,contact_id,title,status,closed_at,
       value_cents,custom_fields,source_metadata
     ) values($1,$2,$3,$4,$5,$6,$7,case when $7='open' then null else now() end,$8,$9,$10)`,
    [
      id,
      options.org ?? GOV_ORG,
      options.pipeline ?? GOV_PIPELINE,
      options.stage ?? GOV_STAGE,
      options.contact,
      options.title ?? `Negócio ${id.slice(0, 6)}`,
      status,
      options.value ?? null,
      options.customFields ?? {},
      options.sourceMetadata ?? {},
    ],
  );
  return id;
}

async function par(): Promise<Par> {
  const contact = await contato();
  const survivor = await negocio({
    contact,
    title: "Card com contexto",
    sourceMetadata: { utm_campaign: "campanha-preservada", page_url: "/captura" },
  });
  const absorbed = await negocio({ contact, title: "Card vazio" });
  return { contact, survivor, absorbed };
}

async function juntar(pair: Par, user = GOV_MANAGER) {
  const result = await comoUsuario(
    user,
    "select fn_juntar_negocios($1,$2,$3) result",
    [GOV_ORG, pair.survivor, pair.absorbed],
  );
  return result.rows[0]!.result as {
    log_id: string;
    survivor_lead_id: string;
    absorbed_lead_id: string;
  };
}

beforeAll(async () => {
  seedGov();
  await pool.query(
    `insert into organizations(id,slug,legal_name,display_name)
     values($1,$2,'Organização vizinha','Organização vizinha')`,
    [ORG_VIZINHA, `merge-neighbor-${ORG_VIZINHA.slice(0, 8)}`],
  );
  await pool.query(
    `insert into crm_pipelines(id,organization_id,name,slug) values
       ($1,$2,'Funil alternativo',$3),
       ($4,$5,'Funil vizinho',$6)`,
    [
      FUNIL_ALTERNATIVO,
      GOV_ORG,
      `merge-alt-${FUNIL_ALTERNATIVO.slice(0, 8)}`,
      FUNIL_VIZINHO,
      ORG_VIZINHA,
      `merge-neighbor-${FUNIL_VIZINHO.slice(0, 8)}`,
    ],
  );
  await pool.query(
    `insert into crm_stages(id,organization_id,pipeline_id,name,slug,position) values
       ($1,$2,$3,'Entrada alternativa',$4,1000),
       ($5,$6,$7,'Entrada vizinha',$8,1000)`,
    [
      ETAPA_ALTERNATIVA,
      GOV_ORG,
      FUNIL_ALTERNATIVO,
      `merge-alt-${ETAPA_ALTERNATIVA.slice(0, 8)}`,
      ETAPA_VIZINHA,
      ORG_VIZINHA,
      FUNIL_VIZINHO,
      `merge-neighbor-${ETAPA_VIZINHA.slice(0, 8)}`,
    ],
  );
});

afterAll(async () => {
  await pool.query("delete from organizations where id=$1", [ORG_VIZINHA]);
  await pool.end();
});

describe("junção reversível de negócios duplicados", () => {
  it("junta e desfaz restaurando a linha e somente os filhos registrados", async () => {
    const pair = await par();
    const activity = randomUUID();
    const link = randomUUID();
    await pool.query(
      `insert into crm_lead_activities(id,organization_id,lead_id,contact_id,source_module,type,payload)
       values($1,$2,$3,$4,'inbox','message_received','{"direction":"inbound"}')`,
      [activity, GOV_ORG, pair.absorbed, pair.contact],
    );
    await pool.query(
      `insert into crm_lead_links(id,organization_id,lead_id,target_kind,target_id,link_kind)
       values($1,$2,$3,'external',$4,'source')`,
      [link, GOV_ORG, pair.absorbed, randomUUID()],
    );
    const before = (
      await pool.query("select to_jsonb(l) state from crm_leads l where id=$1", [pair.absorbed])
    ).rows[0]!.state;

    const merged = await juntar(pair);
    expect(
      (await pool.query("select count(*)::int n from crm_leads where id=$1", [pair.absorbed]))
        .rows[0]!.n,
    ).toBe(0);
    expect(
      (
        await pool.query(
          `select array_agg(id order by id) ids from crm_lead_activities
           where lead_id=$1 and id=$2`,
          [pair.survivor, activity],
        )
      ).rows[0]!.ids,
    ).toEqual([activity]);
    expect(
      (
        await pool.query("select lead_id from crm_lead_links where id=$1", [link])
      ).rows[0]!.lead_id,
    ).toBe(pair.survivor);

    await comoUsuario(GOV_MANAGER, "select fn_desfazer_juncao_de_negocios($1,$2)", [
      GOV_ORG,
      merged.log_id,
    ]);
    const after = (
      await pool.query("select to_jsonb(l) state from crm_leads l where id=$1", [pair.absorbed])
    ).rows[0]!.state;
    expect(after).toEqual(before);
    expect(
      (
        await pool.query("select lead_id from crm_lead_activities where id=$1", [activity])
      ).rows[0]!.lead_id,
    ).toBe(pair.absorbed);
    expect(
      (
        await pool.query("select lead_id from crm_lead_links where id=$1", [link])
      ).rows[0]!.lead_id,
    ).toBe(pair.absorbed);
    expect(
      (await pool.query("select undone_at is not null undone from crm_lead_merge_log where id=$1", [
        merged.log_id,
      ])).rows[0]!.undone,
    ).toBe(true);
  });

  it.each([
    ["valor", 1000, {}, "negocio_absorvido_tem_valor"],
    ["campo", null, { interesse: "alto" }, "negocio_absorvido_tem_campos"],
  ] as const)("recusa absorvido com %s", async (_kind, value, customFields, expected) => {
    const pair = await par();
    await pool.query(
      "update crm_leads set value_cents=$2,custom_fields=$3 where id=$1",
      [pair.absorbed, value, customFields],
    );
    await expect(juntar(pair)).rejects.toThrow(expected);
  });

  it("recusa absorvido com tarefa própria", async () => {
    const pair = await par();
    await pool.query(
      "insert into crm_tasks(organization_id,title,lead_id) values($1,'Retornar',$2)",
      [GOV_ORG, pair.absorbed],
    );
    await expect(juntar(pair)).rejects.toThrow("negocio_absorvido_tem_tarefa");
  });

  it("recusa outro contato, outro funil, outra organização e negócio fechado", async () => {
    const contatoA = await contato();
    const contatoB = await contato();
    const survivor = await negocio({ contact: contatoA, sourceMetadata: { origin: "form" } });

    await expect(
      juntar({ contact: contatoA, survivor, absorbed: await negocio({ contact: contatoB }) }),
    ).rejects.toThrow("negocios_de_contatos_diferentes");
    await expect(
      juntar({
        contact: contatoA,
        survivor,
        absorbed: await negocio({
          contact: contatoA,
          pipeline: FUNIL_ALTERNATIVO,
          stage: ETAPA_ALTERNATIVA,
        }),
      }),
    ).rejects.toThrow("negocios_de_funis_diferentes");
    const contatoVizinho = await contato(ORG_VIZINHA);
    await expect(
      juntar({
        contact: contatoA,
        survivor,
        absorbed: await negocio({
          contact: contatoVizinho,
          org: ORG_VIZINHA,
          pipeline: FUNIL_VIZINHO,
          stage: ETAPA_VIZINHA,
        }),
      }),
    ).rejects.toThrow("negocio_absorvido_nao_encontrado");
    await expect(
      juntar({
        contact: contatoA,
        survivor,
        absorbed: await negocio({ contact: contatoA, status: "won" }),
      }),
    ).rejects.toThrow("negocio_nao_esta_aberto");
  });

  it("desfazer falha fechado quando um filho mudou depois da junção", async () => {
    const pair = await par();
    const activity = randomUUID();
    await pool.query(
      `insert into crm_lead_activities(id,organization_id,lead_id,contact_id,source_module,type)
       values($1,$2,$3,$4,'inbox','message_received')`,
      [activity, GOV_ORG, pair.absorbed, pair.contact],
    );
    const merged = await juntar(pair);
    const other = await negocio({ contact: pair.contact });
    await pool.query("update crm_lead_activities set lead_id=$2 where id=$1", [activity, other]);

    await expect(
      comoUsuario(GOV_MANAGER, "select fn_desfazer_juncao_de_negocios($1,$2)", [
        GOV_ORG,
        merged.log_id,
      ]),
    ).rejects.toThrow("historico_mudou_desde_a_juncao");
    expect(
      (await pool.query("select count(*)::int n from crm_leads where id=$1", [pair.absorbed]))
        .rows[0]!.n,
    ).toBe(0);
  });

  it("usuário sem papel recebe 42501", async () => {
    const pair = await par();
    await expect(juntar(pair, GOV_AGENT_A)).rejects.toMatchObject({ code: "42501" });
  });

  it("log é legível por manager, invisível ao agent e não aceita escrita direta", async () => {
    const pair = await par();
    const merged = await juntar(pair);
    const manager = await comoUsuario(
      GOV_MANAGER,
      "select count(*)::int n from crm_lead_merge_log where id=$1",
      [merged.log_id],
    );
    const agent = await comoUsuario(
      GOV_AGENT_A,
      "select count(*)::int n from crm_lead_merge_log where id=$1",
      [merged.log_id],
    );
    expect(manager.rows[0]!.n).toBe(1);
    expect(agent.rows[0]!.n).toBe(0);
    await expect(
      comoUsuario(
        GOV_MANAGER,
        `insert into crm_lead_merge_log(
           organization_id,survivor_lead_id,absorbed_lead_id,absorbed_snapshot
         ) values($1,$2,$3,'{}')`,
        [GOV_ORG, randomUUID(), randomUUID()],
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("grupo em que todos têm contexto não aparece nos candidatos", async () => {
    const contact = await contato();
    await negocio({ contact, sourceMetadata: { utm_campaign: "campanha-a" } });
    await negocio({ contact, customFields: { produto: "produto-b" } });

    const result = await comoUsuario(
      GOV_MANAGER,
      "select contact_id from fn_candidatos_negocios_duplicados($1) where contact_id=$2",
      [GOV_ORG, contact],
    );
    expect(result.rows).toEqual([]);
  });

  it("candidatos incluem vazio com contexto e todos vazios com o mais antigo sugerido", async () => {
    const contextual = await par();
    const contatoVazio = await contato();
    const antigo = await negocio({ contact: contatoVazio, title: "Vazio antigo" });
    const novo = await negocio({ contact: contatoVazio, title: "Vazio novo" });
    await pool.query(
      `update crm_leads set created_at = case id
         when $1 then '2030-01-01T10:00:00Z'::timestamptz
         when $2 then '2030-01-02T10:00:00Z'::timestamptz
       end where id in ($1,$2)`,
      [antigo, novo],
    );

    const result = await comoUsuario(
      GOV_MANAGER,
      `select contact_id,classification,survivor,absorbed
         from fn_candidatos_negocios_duplicados($1)
        where contact_id=any($2::uuid[])
        order by contact_id`,
      [GOV_ORG, [contextual.contact, contatoVazio]],
    );
    const porContato = new Map(result.rows.map((row) => [row.contact_id, row]));
    expect(porContato.get(contextual.contact)).toMatchObject({
      classification: "vazio_com_contexto",
      survivor: expect.objectContaining({ id: contextual.survivor }),
      absorbed: [expect.objectContaining({ id: contextual.absorbed })],
    });
    expect(porContato.get(contatoVazio)).toMatchObject({
      classification: "todos_vazios",
      survivor: expect.objectContaining({ id: antigo }),
      absorbed: [expect.objectContaining({ id: novo })],
    });
  });
});
