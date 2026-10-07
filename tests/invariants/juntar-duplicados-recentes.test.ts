import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GOV_MANAGER, seedGov } from "./gov-helpers";

const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${process.env.TEST_DB_PORT ?? 54329}/postgres`,
  max: 4,
});

const ORG = randomUUID();
const PIPELINE = randomUUID();
const STAGE = randomUUID();
const OUTRO_PIPELINE = randomUUID();
const OUTRA_STAGE = randomUUID();

interface LeadOptions {
  contact: string;
  pipeline?: string;
  stage?: string;
  source: "webhook" | "whatsapp";
  sourceMetadata?: Record<string, unknown>;
  createdAt: Date;
  status?: "open" | "won";
}

async function contato(): Promise<string> {
  const id = randomUUID();
  await pool.query(
    "insert into contacts(id,organization_id,display_name) values($1,$2,'Contato do teste')",
    [id, ORG],
  );
  return id;
}

async function negocio(options: LeadOptions): Promise<string> {
  const id = randomUUID();
  const status = options.status ?? "open";
  await pool.query(
    `insert into crm_leads(
       id,organization_id,pipeline_id,stage_id,contact_id,title,status,closed_at,
       source,source_metadata,custom_fields,tags,created_at,updated_at
     ) values(
       $1,$2,$3,$4,$5,$6,$7,case when $7='open' then null else $9::timestamptz end,
       $8,$10,'{}','{}',$9,$9
     )`,
    [
      id,
      ORG,
      options.pipeline ?? PIPELINE,
      options.stage ?? STAGE,
      options.contact,
      options.source === "webhook" ? "Card com contexto" : "Card vazio do WhatsApp",
      status,
      options.source,
      options.createdAt.toISOString(),
      options.sourceMetadata ?? {},
    ],
  );
  return id;
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

beforeAll(async () => {
  seedGov();
  await pool.query(
    `insert into organizations(id,slug,legal_name,display_name)
     values($1,$2,'Organização da junção recente','Organização da junção recente')`,
    [ORG, `merge-recent-${ORG.slice(0, 8)}`],
  );
  await pool.query(
    `insert into user_organizations(user_id,organization_id,role)
     values($1,$2,'manager')`,
    [GOV_MANAGER, ORG],
  );
  await pool.query(
    `insert into crm_pipelines(id,organization_id,name,slug) values
       ($1,$2,'Funil principal',$3),
       ($4,$2,'Outro funil',$5)`,
    [
      PIPELINE,
      ORG,
      `merge-recent-main-${PIPELINE.slice(0, 8)}`,
      OUTRO_PIPELINE,
      `merge-recent-other-${OUTRO_PIPELINE.slice(0, 8)}`,
    ],
  );
  await pool.query(
    `insert into crm_stages(id,organization_id,pipeline_id,name,slug,position) values
       ($1,$2,$3,'Entrada',$4,1000),
       ($5,$2,$6,'Outra entrada',$7,1000)`,
    [
      STAGE,
      ORG,
      PIPELINE,
      `merge-recent-main-${STAGE.slice(0, 8)}`,
      OUTRA_STAGE,
      OUTRO_PIPELINE,
      `merge-recent-other-${OUTRA_STAGE.slice(0, 8)}`,
    ],
  );
});

afterAll(async () => {
  await pool.query("delete from organizations where id=$1", [ORG]);
  await pool.end();
});

describe("junção automática de duplicados recentes", () => {
  it("junta somente o par seguro, preserva contexto, é idempotente e permite desfazer", async () => {
    const agora = Date.now();

    const contatoElegivel = await contato();
    const survivor = await negocio({
      contact: contatoElegivel,
      source: "webhook",
      sourceMetadata: { utm_campaign: "campanha-preservada", page_url: "/captura" },
      createdAt: new Date(agora - 70_000),
    });
    const absorbed = await negocio({
      contact: contatoElegivel,
      source: "whatsapp",
      createdAt: new Date(agora - 60_000),
    });

    const contatoForaDaJanela = await contato();
    const antigoForaDaJanela = await negocio({
      contact: contatoForaDaJanela,
      source: "webhook",
      sourceMetadata: { utm_campaign: "distante" },
      createdAt: new Date(agora - 5 * 60_000),
    });
    const novoForaDaJanela = await negocio({
      contact: contatoForaDaJanela,
      source: "whatsapp",
      createdAt: new Date(agora - 60_000),
    });

    const contatoFunisDiferentes = await contato();
    const leadFunilPrincipal = await negocio({
      contact: contatoFunisDiferentes,
      source: "webhook",
      sourceMetadata: { utm_campaign: "principal" },
      createdAt: new Date(agora - 70_000),
    });
    const leadOutroFunil = await negocio({
      contact: contatoFunisDiferentes,
      pipeline: OUTRO_PIPELINE,
      stage: OUTRA_STAGE,
      source: "whatsapp",
      createdAt: new Date(agora - 60_000),
    });

    const contatoFechado = await contato();
    const leadAberto = await negocio({
      contact: contatoFechado,
      source: "webhook",
      sourceMetadata: { utm_campaign: "aberto" },
      createdAt: new Date(agora - 70_000),
    });
    const leadFechado = await negocio({
      contact: contatoFechado,
      source: "whatsapp",
      createdAt: new Date(agora - 60_000),
      status: "won",
    });

    const contatoAindaEmCriacao = await contato();
    const leadRecenteComContexto = await negocio({
      contact: contatoAindaEmCriacao,
      source: "webhook",
      sourceMetadata: { utm_campaign: "ainda-em-criacao" },
      createdAt: new Date(agora - 15_000),
    });
    const leadRecenteVazio = await negocio({
      contact: contatoAindaEmCriacao,
      source: "whatsapp",
      createdAt: new Date(agora - 5_000),
    });

    const contatoComRisco = await contato();
    const riscoSurvivor = await negocio({
      contact: contatoComRisco,
      source: "webhook",
      sourceMetadata: { utm_campaign: "risco" },
      createdAt: new Date(agora - 70_000),
    });
    const riscoAbsorbed = await negocio({
      contact: contatoComRisco,
      source: "whatsapp",
      createdAt: new Date(agora - 60_000),
    });
    await pool.query(
      `insert into crm_lead_risk_states(lead_id,organization_id,bucket,since,cold_hours)
       values($1,$3,'em_risco',now() - interval '1 hour',24),
             ($2,$3,'em_risco',now() - interval '1 hour',24)`,
      [riscoSurvivor, riscoAbsorbed, ORG],
    );

    const primeira = await comoServico(
      "select fn_juntar_duplicados_recentes($1,$2,$3,$4) result",
      [50, "2 minutes", "20 seconds", ORG],
    );
    expect(primeira.rows[0]!.result).toEqual({
      juntados: 1,
      ignorados_por_risco: 1,
    });

    const mantido = await pool.query(
      "select source,source_metadata from crm_leads where id=$1 and organization_id=$2",
      [survivor, ORG],
    );
    expect(mantido.rows[0]).toMatchObject({
      source: "webhook",
      source_metadata: { utm_campaign: "campanha-preservada", page_url: "/captura" },
    });
    expect(
      (await pool.query("select count(*)::int n from crm_leads where id=$1", [absorbed])).rows[0]!
        .n,
    ).toBe(0);

    const log = await pool.query(
      `select id,merged_by_user_id from crm_lead_merge_log
        where organization_id=$1 and survivor_lead_id=$2 and absorbed_lead_id=$3`,
      [ORG, survivor, absorbed],
    );
    expect(log.rows).toHaveLength(1);
    expect(log.rows[0]!.merged_by_user_id).toBeNull();
    const atividade = await pool.query(
      `select actor_kind,reason from crm_lead_activities
        where organization_id=$1 and lead_id=$2 and source_id=$3`,
      [ORG, survivor, log.rows[0]!.id],
    );
    expect(atividade.rows[0]).toEqual({
      actor_kind: "system",
      reason: "junção automática: formulário e WhatsApp do mesmo contato em até 2 minutos",
    });

    for (const id of [
      antigoForaDaJanela,
      novoForaDaJanela,
      leadFunilPrincipal,
      leadOutroFunil,
      leadAberto,
      leadFechado,
      leadRecenteComContexto,
      leadRecenteVazio,
      riscoSurvivor,
      riscoAbsorbed,
    ]) {
      expect(
        (await pool.query("select count(*)::int n from crm_leads where id=$1", [id])).rows[0]!.n,
      ).toBe(1);
    }

    const segunda = await comoServico(
      "select fn_juntar_duplicados_recentes($1,$2,$3,$4) result",
      [50, "2 minutes", "20 seconds", ORG],
    );
    expect(segunda.rows[0]!.result).toEqual({
      juntados: 0,
      ignorados_por_risco: 1,
    });
    expect(
      (
        await pool.query(
          `select count(*)::int n from crm_lead_merge_log
            where organization_id=$1 and survivor_lead_id=$2 and absorbed_lead_id=$3
              and undone_at is null`,
          [ORG, survivor, absorbed],
        )
      ).rows[0]!.n,
    ).toBe(1);

    await comoGerente("select fn_desfazer_juncao_de_negocios($1,$2)", [ORG, log.rows[0]!.id]);
    expect(
      (await pool.query("select count(*)::int n from crm_leads where id=$1", [absorbed])).rows[0]!
        .n,
    ).toBe(1);
    expect(
      (await pool.query("select undone_at is not null undone from crm_lead_merge_log where id=$1", [
        log.rows[0]!.id,
      ])).rows[0]!.undone,
    ).toBe(true);
  });

  it("anon e authenticated não têm EXECUTE; service_role tem", async () => {
    const privileges = await pool.query(
      `select
         has_function_privilege('anon',
           'public.fn_juntar_duplicados_recentes(integer,interval,interval,uuid)', 'EXECUTE') anon,
         has_function_privilege('authenticated',
           'public.fn_juntar_duplicados_recentes(integer,interval,interval,uuid)', 'EXECUTE') authenticated,
         has_function_privilege('service_role',
           'public.fn_juntar_duplicados_recentes(integer,interval,interval,uuid)', 'EXECUTE') service_role`,
    );
    expect(privileges.rows[0]).toEqual({
      anon: false,
      authenticated: false,
      service_role: true,
    });
  });
});
