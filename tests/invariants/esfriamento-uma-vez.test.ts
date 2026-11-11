import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const buckets = vi.hoisted(() => ({ atuais: vi.fn() }));

vi.mock("@/lib/leads/risk-seed", () => ({
  calculaBucketsAtuais: buckets.atuais,
}));
vi.mock("@/lib/leads/reactivation", () => ({
  propoeReativacao: vi.fn(async () => null),
}));

import { observaTravessias } from "@/lib/leads/risk-worker";

/**
 * "Negócio esfriou" uma vez por episódio, contra o Postgres do clone.
 *
 * O defeito de produção: a passada do vigia não via o estado já gravado além
 * da primeira página e inseria lead_cooled de novo. Aqui o banco aceita a
 * linha de verdade (FK, CHECK, trigger de relógio) e a segunda passada não
 * aumenta a contagem. A limpeza manual roda o script como o operador roda,
 * e só dentro deste banco efêmero.
 */

if (!process.env.TEST_DB_CONTAINER) {
  throw new Error("TEST_DB_CONTAINER ausente — rode via pnpm test:db");
}

const PORT = Number(process.env.TEST_DB_PORT ?? 54329);
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`,
  max: 2,
});

const ORG = randomUUID();
const PIPE = randomUUID();
const STAGE = randomUUID();

beforeAll(async () => {
  await pool.query(
    `insert into public.organizations (id, slug, legal_name, display_name)
     values ($1, $2, 'Esfriamento', 'Esfriamento')`,
    [ORG, `esfriamento-${ORG.slice(0, 8)}`],
  );
  await pool.query(
    `insert into public.crm_pipelines (id, organization_id, name, slug, is_default)
     values ($1, $2, 'Funil', 'funil-esfriamento', false)`,
    [PIPE, ORG],
  );
  await pool.query(
    `insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position)
     values ($1, $2, $3, 'Novo', 'novo', 1000)`,
    [STAGE, ORG, PIPE],
  );
});

afterAll(async () => {
  await pool.query(`delete from public.organizations where id = $1`, [ORG]);
  await pool.end();
});

async function novoLead(): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `insert into public.crm_leads
       (id, organization_id, pipeline_id, stage_id, title, status, position_in_stage, last_activity_at)
     values ($1, $2, $3, $4, 'Negócio parado', 'open', 1000, now() - interval '30 days')`,
    [id, ORG, PIPE, STAGE],
  );
  return id;
}

async function atividade(
  leadId: string,
  type: string,
  performedAt: string,
): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `insert into public.crm_lead_activities
       (id, organization_id, lead_id, type, source_module, source_id, actor_kind,
        performed_at, created_at, reason)
     values ($1, $2, $3, $4, 'crm', $3, 'system', $5, $5, $4)`,
    [id, ORG, leadId, type, performedAt],
  );
  return id;
}

async function contar(leadId: string, type: string): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    `select count(*)::int as n
       from public.crm_lead_activities
      where organization_id = $1 and lead_id = $2 and type = $3`,
    [ORG, leadId, type],
  );
  return rows[0]!.n;
}

function adminReal(): { from: (table: string) => unknown } {
  return {
    from(table: string) {
      const filtros: Array<{ op: "eq" | "gt" | "in"; col: string; val: unknown }> = [];
      const ordens: Array<{ col: string; asc: boolean }> = [];
      let faixa: { de: number; ate: number } | null = null;
      let limite: number | null = null;
      const permitidas = new Set(["organization_id", "lead_id", "type", "performed_at", "id", "bucket"]);

      async function ler(): Promise<Record<string, unknown>[]> {
        if (table !== "crm_lead_risk_states" && table !== "crm_lead_activities") {
          throw new Error(`tabela inesperada ${table}`);
        }
        const params: unknown[] = [];
        const partes: string[] = [];
        for (const filtro of filtros) {
          if (!permitidas.has(filtro.col)) throw new Error(`coluna ${filtro.col}`);
          params.push(filtro.val);
          const n = params.length;
          if (filtro.op === "eq") partes.push(`${filtro.col} = $${n}`);
          else if (filtro.op === "gt") partes.push(`${filtro.col} > $${n}`);
          else partes.push(`${filtro.col} = ANY($${n})`);
        }
        const ordem = ordens
          .map((item) => {
            if (!permitidas.has(item.col)) throw new Error(`ordem ${item.col}`);
            return `${item.col} ${item.asc ? "ASC" : "DESC"}`;
          })
          .join(", ");
        let paginacao = "";
        if (faixa) {
          params.push(faixa.ate - faixa.de + 1);
          params.push(faixa.de);
          paginacao = ` limit $${params.length - 1} offset $${params.length}`;
        } else if (limite != null) {
          params.push(limite);
          paginacao = ` limit $${params.length}`;
        }
        const { rows } = await pool.query(
          `select * from public.${table}
            ${partes.length ? `where ${partes.join(" and ")}` : ""}
            ${ordem ? `order by ${ordem}` : ""}
            ${paginacao}`,
          params,
        );
        return rows.map((row: Record<string, unknown>) => ({
          ...row,
          performed_at:
            row.performed_at instanceof Date ? row.performed_at.toISOString() : row.performed_at,
        }));
      }

      const q = {
        select: () => q,
        eq: (col: string, val: unknown) => {
          filtros.push({ op: "eq", col, val });
          return q;
        },
        gt: (col: string, val: unknown) => {
          filtros.push({ op: "gt", col, val });
          return q;
        },
        in: (col: string, val: unknown) => {
          filtros.push({ op: "in", col, val });
          return q;
        },
        order: (col: string, opts?: { ascending?: boolean }) => {
          ordens.push({ col, asc: opts?.ascending !== false });
          return q;
        },
        range: (de: number, ate: number) => {
          faixa = { de, ate };
          return q;
        },
        limit: (n: number) => {
          limite = n;
          return q;
        },
        maybeSingle: async () => {
          if (limite == null) limite = 1;
          const rows = await ler();
          return { data: rows[0] ?? null, error: null };
        },
        then: (
          resolve: (value: unknown) => unknown,
          reject?: (motivo: unknown) => unknown,
        ) => ler().then((data) => resolve({ data, error: null }), reject),
        insert: async (row: Record<string, unknown>) => {
          await pool.query(
            `insert into public.crm_lead_activities
              (organization_id, lead_id, contact_id, type, source_module, source_id,
               actor_kind, actor_agent_id, performed_by_user_id, reason, evidence, payload)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb)`,
            [
              row.organization_id,
              row.lead_id,
              row.contact_id,
              row.type,
              row.source_module,
              row.source_id,
              row.actor_kind,
              row.actor_agent_id,
              row.performed_by_user_id,
              row.reason,
              row.evidence == null ? null : JSON.stringify(row.evidence),
              JSON.stringify(row.payload ?? {}),
            ],
          );
          return { error: null };
        },
        upsert: async (row: Record<string, unknown>) => {
          await pool.query(
            `insert into public.crm_lead_risk_states
              (lead_id, organization_id, bucket, since, cold_hours)
             values ($1,$2,$3,$4,$5)
             on conflict (lead_id) do update
               set bucket = excluded.bucket,
                   since = excluded.since,
                   cold_hours = excluded.cold_hours`,
            [row.lead_id, row.organization_id, row.bucket, row.since, row.cold_hours],
          );
          return { error: null };
        },
      };
      return q;
    },
  };
}

function calcular(leadId: string, bucket: "em_dia" | "em_risco" | "critico") {
  buckets.atuais.mockResolvedValue([
    {
      leadId,
      contactId: null,
      bucket,
      since: new Date("2026-09-01T00:00:00.000Z"),
      coldHours: 24,
    },
  ]);
}

describe("esfriamento uma vez por episódio", () => {
  it("negócio parado não ganha uma segunda linha, nem quando o bucket piora", async () => {
    const leadId = await novoLead();
    await pool.query(
      `insert into public.crm_lead_risk_states
         (lead_id, organization_id, bucket, since, cold_hours)
       values ($1, $2, 'em_risco', now() - interval '20 days', 24)`,
      [leadId, ORG],
    );
    await atividade(leadId, "lead_cooled", "2026-09-10T12:00:00.000Z");
    calcular(leadId, "critico");

    const admin = adminReal();
    const primeira = await observaTravessias(admin as never, ORG, new Date("2026-10-14T12:00:00.000Z"));
    const segunda = await observaTravessias(admin as never, ORG, new Date("2026-10-14T12:15:00.000Z"));

    expect(primeira.esfriaram).toBe(0);
    expect(segunda.esfriaram).toBe(0);
    expect(await contar(leadId, "lead_cooled")).toBe(1);
    const { rows } = await pool.query<{ bucket: string }>(
      `select bucket from public.crm_lead_risk_states where lead_id = $1`,
      [leadId],
    );
    expect(rows[0]?.bucket).toBe("critico");
  });

  it("estado invisível com episódio já aberto também não grava de novo", async () => {
    const leadId = await novoLead();
    await atividade(leadId, "lead_cooled", "2026-09-10T12:00:00.000Z");
    calcular(leadId, "critico");

    const resultado = await observaTravessias(adminReal() as never, ORG);

    expect(resultado.esfriaram).toBe(0);
    expect(resultado.esfriamentosJaRegistrados).toBe(1);
    expect(await contar(leadId, "lead_cooled")).toBe(1);
  });

  it("depois de voltar a andar, um esfriamento novo entra na timeline", async () => {
    const leadId = await novoLead();
    await atividade(leadId, "lead_cooled", "2026-08-01T12:00:00.000Z");
    await atividade(leadId, "note", "2026-09-15T12:00:00.000Z");
    await pool.query(
      `insert into public.crm_lead_risk_states
         (lead_id, organization_id, bucket, since, cold_hours)
       values ($1, $2, 'em_dia', now() - interval '2 days', 24)`,
      [leadId, ORG],
    );
    calcular(leadId, "em_risco");

    const resultado = await observaTravessias(adminReal() as never, ORG);

    expect(resultado.esfriaram).toBe(1);
    expect(await contar(leadId, "lead_cooled")).toBe(2);
    expect(await contar(leadId, "note")).toBe(1);
  });
});

describe("script de limpeza das repetições", () => {
  it("mantém a primeira linha de cada sequência e apaga o resto", async () => {
    const leadId = await novoLead();
    const outro = await novoLead();
    const primeiro = await atividade(leadId, "lead_cooled", "2026-09-01T12:00:00.000Z");
    const repetido = await atividade(leadId, "lead_cooled", "2026-09-01T12:15:00.000Z");
    const nota = await atividade(leadId, "note", "2026-09-10T12:00:00.000Z");
    const deNovo = await atividade(leadId, "lead_cooled", "2026-09-20T12:00:00.000Z");
    const repetidoDeNovo = await atividade(leadId, "lead_cooled", "2026-09-20T12:15:00.000Z");
    const unico = await atividade(outro, "lead_cooled", "2026-09-05T12:00:00.000Z");
    const perdido = await atividade(outro, "voice_call_missed", "2026-09-05T13:00:00.000Z");
    const aindaRepetido = await atividade(outro, "lead_cooled", "2026-09-05T14:00:00.000Z");

    const script = readFileSync(
      join(__dirname, "..", "..", "scripts/ops/limpar-negocio-esfriou-repetido.sql"),
      "utf8",
    );
    execFileSync(
      "docker",
      [
        "exec",
        "-i",
        process.env.TEST_DB_CONTAINER!,
        "psql",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-v",
        "ON_ERROR_STOP=1",
        "-f",
        "-",
      ],
      { input: script, encoding: "utf8" },
    );

    const { rows } = await pool.query<{ id: string }>(
      `select id::text as id
         from public.crm_lead_activities
        where lead_id = any($1::uuid[])
        order by performed_at, created_at, id`,
      [[leadId, outro]],
    );
    const ids = rows.map((linha) => linha.id);
    expect(ids).toEqual([primeiro, unico, perdido, nota, deNovo]);
    expect(ids).not.toContain(repetido);
    expect(ids).not.toContain(repetidoDeNovo);
    expect(ids).not.toContain(aindaRepetido);

    const identificacao = script.split("-- BEGIN IDENTIFICACAO")[1]?.split("-- END IDENTIFICACAO")[0];
    const segunda = await pool.query(`select count(*)::int as n from (${identificacao}) duplicatas`);
    expect(segunda.rows[0]?.n).toBe(0);
  });
});
