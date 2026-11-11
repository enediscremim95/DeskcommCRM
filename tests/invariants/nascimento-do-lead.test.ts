import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { funilDeEntrada, garantirLeadDaConversa } from "@/lib/leads/nascimento-do-lead";

import { pgComoSupabase } from "../pg-como-supabase";

/**
 * A CONVERSA VIRA LEAD — o elo que faltava (spec 17 §3).
 *
 * Aqui roda a FUNÇÃO, não uma reescrita da consulta em SQL: `pgComoSupabase`
 * troca só o transporte, e o instrumento tem teste próprio
 * (`pg-como-supabase.test.ts`) porque adaptador que ignora filtro faz tudo
 * abaixo passar pelo motivo errado.
 *
 * Invariante de banco e não teste de unidade porque o que se mede é escolha
 * feita **contra o schema real**: qual etapa é a de entrada depende de
 * `position`, `is_won`, `is_lost` e `is_archived` existirem e valerem — e da
 * organização nascer com funil, o que é um TRIGGER
 * (`fn_seed_default_pipeline_for_org`). Nada disso existe fora do Postgres.
 *
 * Congela: (1) o lead nasce na etapa de entrada e emite atividade; (2) um por
 * demanda, não um por mensagem; (3) demanda nova depois de fechada; (4) quem
 * pediu para sair não vira oportunidade; (5) cada recusa tem motivo próprio;
 * (6) etapa de ganho/perda nunca é a de entrada, mesmo sendo a primeira.
 */
const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)");
}

const PORT = Number(process.env.TEST_DB_PORT ?? 54329);
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`,
  max: 8,
});
const db = pgComoSupabase(pool);

/** Org normal: fica com o funil que o trigger semeia. */
const ORG_VIVA = "1ead7e00-0000-4000-8000-000000000001";
/** Org sem funil padrão — o semeado é apagado no setup. */
const ORG_SEM_FUNIL = "1ead7e00-0000-4000-8000-000000000002";
/** Org cujo único funil só tem etapas de ganho/perda. */
const ORG_SO_FECHADAS = "1ead7e00-0000-4000-8000-000000000003";
/** Org com etapa de GANHO na posição 0 — a armadilha do §6. */
const ORG_GANHO_PRIMEIRO = "1ead7e00-0000-4000-8000-000000000004";

const CONVERSA = "1ead7e00-0000-4000-8000-00000000c001";

async function criarOrg(id: string, slug: string): Promise<void> {
  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name)
     values ($1, $2, 'Nascimento LTDA', 'Nascimento') on conflict (id) do nothing`,
    [id, slug],
  );
}

async function criarContato(org: string, nome: string | null): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into contacts (organization_id, display_name, source) values ($1, $2, 'whatsapp') returning id`,
    [org, nome],
  );
  return rows[0]!.id;
}

interface LeadExistenteArgs {
  contato: string;
  pipelineId: string;
  stageId: string;
  titulo: string;
  criadoHa: string;
  status?: "open" | "won" | "lost";
  source?: string;
  guardKey?: string | null;
  position?: number;
}

async function criarLeadExistente(args: LeadExistenteArgs): Promise<string> {
  const status = args.status ?? "open";
  const { rows } = await pool.query<{ id: string }>(
    `insert into crm_leads
       (organization_id, pipeline_id, stage_id, contact_id, title, status,
        closed_at, lost_reason, source, reentry_guard_key, position_in_stage, created_at)
     values
       ($1, $2, $3, $4, $5, $6,
        case when $6 = 'open' then null else now() end,
        case when $6 = 'lost' then 'Sem avanço' else null end,
        $7, $8, $9, now() - $10::interval)
     returning id`,
    [
      ORG_VIVA,
      args.pipelineId,
      args.stageId,
      args.contato,
      args.titulo,
      status,
      args.source ?? "manual",
      args.guardKey ?? null,
      args.position ?? 1000,
      args.criadoHa,
    ],
  );
  return rows[0]!.id;
}

let FUNIL_ENTRADA = "";
let ETAPA_ENTRADA = "";
let ETAPA_POSTERIOR = "";
let NOME_ETAPA_POSTERIOR = "";
let OUTRO_FUNIL = "";
let ETAPA_OUTRO_FUNIL = "";

beforeAll(async () => {
  await criarOrg(ORG_VIVA, "org-nascimento-viva");
  await criarOrg(ORG_SEM_FUNIL, "org-nascimento-sem-funil");
  await criarOrg(ORG_SO_FECHADAS, "org-nascimento-so-fechadas");
  await criarOrg(ORG_GANHO_PRIMEIRO, "org-nascimento-ganho-primeiro");

  // ORG_SEM_FUNIL: apaga o que o trigger semeou. Um tenant que arquivou ou
  // apagou o funil padrão chega neste estado sem fazer nada de errado.
  await pool.query("delete from crm_stages where organization_id = $1", [ORG_SEM_FUNIL]);
  await pool.query("delete from crm_pipelines where organization_id = $1", [ORG_SEM_FUNIL]);

  // ORG_SO_FECHADAS: mantém o funil padrão, remove toda etapa aberta.
  await pool.query(
    "delete from crm_stages where organization_id = $1 and is_won = false and is_lost = false",
    [ORG_SO_FECHADAS],
  );

  // ORG_GANHO_PRIMEIRO: funil próprio, com "Ganho" ANTES da entrada.
  await pool.query("delete from crm_stages where organization_id = $1", [ORG_GANHO_PRIMEIRO]);
  await pool.query("delete from crm_pipelines where organization_id = $1", [ORG_GANHO_PRIMEIRO]);
  const { rows } = await pool.query<{ id: string }>(
    `insert into crm_pipelines (organization_id, name, slug, is_default, position)
     values ($1, 'Funil torto', 'funil-torto', true, 1000) returning id`,
    [ORG_GANHO_PRIMEIRO],
  );
  const funilTorto = rows[0]!.id;
  await pool.query(
    `insert into crm_stages (organization_id, pipeline_id, name, slug, position, is_won, is_lost) values
       ($1, $2, 'Ganho',   'ganho-torto',   0, true,  false),
       ($1, $2, 'Perdido', 'perdido-torto', 1, false, true),
       ($1, $2, 'Entrada', 'entrada-torta', 2, false, false)`,
    [ORG_GANHO_PRIMEIRO, funilTorto],
  );

  const { rows: entrada } = await pool.query<{ pipeline_id: string; stage_id: string }>(
    `select p.id as pipeline_id, s.id as stage_id
       from crm_pipelines p
       join crm_stages s on s.pipeline_id = p.id
      where p.organization_id = $1 and p.is_default = true and p.is_archived = false
        and s.is_archived = false and s.is_won = false and s.is_lost = false
      order by s.position asc
      limit 1`,
    [ORG_VIVA],
  );
  FUNIL_ENTRADA = entrada[0]!.pipeline_id;
  ETAPA_ENTRADA = entrada[0]!.stage_id;

  NOME_ETAPA_POSTERIOR = "Contato Realizado";
  const { rows: posterior } = await pool.query<{ id: string }>(
    `insert into crm_stages
       (organization_id, pipeline_id, name, slug, position, is_won, is_lost)
     values
       ($1, $2, $3, 'contato-realizado-reentrada',
        (select coalesce(max(position), 0) + 1000 from crm_stages where pipeline_id = $2),
        false, false)
     returning id`,
    [ORG_VIVA, FUNIL_ENTRADA, NOME_ETAPA_POSTERIOR],
  );
  ETAPA_POSTERIOR = posterior[0]!.id;

  const { rows: outroFunil } = await pool.query<{ id: string }>(
    `insert into crm_pipelines (organization_id, name, slug, is_default, position)
     values ($1, 'Pós-venda', 'pos-venda-reentrada', false, 9000)
     returning id`,
    [ORG_VIVA],
  );
  OUTRO_FUNIL = outroFunil[0]!.id;
  const { rows: outraEtapa } = await pool.query<{ id: string }>(
    `insert into crm_stages
       (organization_id, pipeline_id, name, slug, position, is_won, is_lost)
     values ($1, $2, 'Em atendimento', 'em-atendimento-reentrada', 1000, false, false)
     returning id`,
    [ORG_VIVA, OUTRO_FUNIL],
  );
  ETAPA_OUTRO_FUNIL = outraEtapa[0]!.id;
});

afterAll(async () => {
  await pool.query("delete from organizations where id = any($1)", [
    [ORG_VIVA, ORG_SEM_FUNIL, ORG_SO_FECHADAS, ORG_GANHO_PRIMEIRO],
  ]);
  await pool.end();
});

describe("o lead NASCE", () => {
  it("a organização nasce com funil padrão — sem isto, todo caminho feliz abaixo é vazio", async () => {
    // Controle positivo do AMBIENTE: o caminho feliz depende de um TRIGGER
    // (`fn_seed_default_pipeline_for_org`). Se ele sumisse do baseline, os casos
    // seguintes cairiam em `sem_funil_de_entrada` e alguém leria isso como
    // "a regra está funcionando" em vez de "o produto perdeu o funil padrão".
    const destino = await funilDeEntrada(db, ORG_VIVA);
    expect(destino, "org recém-criada tem de ter funil de entrada").not.toHaveProperty("erro");
  });

  it("entra na primeira etapa do funil padrão, ligado ao contato", async () => {
    const contato = await criarContato(ORG_VIVA, "Joana da Silva");
    const r = await garantirLeadDaConversa(db, {
      organizationId: ORG_VIVA,
      contactId: contato,
      conversationId: CONVERSA,
      nomeDoContato: "Joana da Silva",
    });

    expect(r.criado, `esperava criar, veio ${JSON.stringify(r)}`).toBe(true);
    if (!r.criado) return;

    const { rows } = await pool.query<{
      title: string;
      contact_id: string | null;
      status: string;
      stage_name: string;
      stage_position: string;
      pipeline_is_default: boolean;
    }>(
      `select l.title, l.contact_id, l.status, s.name as stage_name, s.position as stage_position,
              p.is_default as pipeline_is_default
         from crm_leads l
         join crm_stages s on s.id = l.stage_id
         join crm_pipelines p on p.id = l.pipeline_id
        where l.id = $1`,
      [r.leadId],
    );
    const lead = rows[0]!;
    // O VÍNCULO — é literalmente o defeito medido: 13 de 15 leads da produção
    // tinham este campo nulo.
    expect(lead.contact_id, "o lead tem de apontar para o contato").toBe(contato);
    expect(lead.title).toBe("Joana da Silva");
    expect(lead.status).toBe("open");
    expect(lead.pipeline_is_default, "tem de nascer no funil de entrada").toBe(true);

    // E é a PRIMEIRA etapa aberta do funil, não uma qualquer.
    const { rows: primeira } = await pool.query<{ name: string }>(
      `select name from crm_stages
        where pipeline_id = (select pipeline_id from crm_leads where id = $1)
          and is_archived = false and is_won = false and is_lost = false
        order by position asc limit 1`,
      [r.leadId],
    );
    expect(lead.stage_name).toBe(primeira[0]!.name);
  });

  it("emite atividade de sistema — card que aparece sozinho destrói a confiança no automatismo", async () => {
    const contato = await criarContato(ORG_VIVA, "Registro Silva");
    const r = await garantirLeadDaConversa(db, {
      organizationId: ORG_VIVA,
      contactId: contato,
      conversationId: CONVERSA,
      nomeDoContato: "Registro Silva",
    });
    expect(r.criado).toBe(true);
    if (!r.criado) return;

    const { rows } = await pool.query<{
      type: string;
      actor_kind: string | null;
      source_module: string;
      source_id: string | null;
      contact_id: string | null;
      reason: string | null;
    }>(
      `select type, actor_kind, source_module, source_id, contact_id, reason
         from crm_lead_activities where lead_id = $1`,
      [r.leadId],
    );
    expect(rows, "uma linha na timeline, exatamente").toHaveLength(1);
    const at = rows[0]!;
    expect(at.type).toBe("lead_created");
    // `system` e não `ai`: quem criou foi o runtime, e afirmar autoria da IA sem
    // lastro é o que a 0071 existe para impedir.
    expect(at.actor_kind).toBe("system");
    expect(at.source_module).toBe("canal.ingest");
    expect(at.source_id, "a conversa que originou fica registrada").toBe(CONVERSA);
    expect(at.contact_id).toBe(contato);
    expect(at.reason).toBeTruthy();
  });

  it("o título vem do CADASTRO, não do payload — contato conhecido não vira 'Novo contato'", async () => {
    // O defeito era do próprio passo 1: `nomeDoContato` vinha de
    // `notifyNameOf(p)` cru. O WAHA manda inbound SEM `pushName` (2 de 271
    // medidos) e TODO ack vem assim — então um cliente que o CRM conhece pelo
    // nome abria um card chamado "Novo contato pelo WhatsApp".
    const contato = await criarContato(ORG_VIVA, "Conhecido Andrade");
    const r = await garantirLeadDaConversa(db, {
      organizationId: ORG_VIVA,
      contactId: contato,
      conversationId: CONVERSA,
      nomeDoContato: null, // a mensagem veio sem nome
    });
    expect(r.criado).toBe(true);
    if (!r.criado) return;
    const { rows } = await pool.query<{ title: string }>(
      "select title from crm_leads where id = $1",
      [r.leadId],
    );
    expect(rows[0]!.title).toBe("Conhecido Andrade");
  });

  it("rótulo TÉCNICO no cadastro não vaza para o título do card", async () => {
    // Ler o cadastro abriu esta porta: 3 contatos da produção têm
    // `Contato 543134@lid` gravado. Sem a guarda, o kanban — que hoje está
    // limpo — receberia o resíduo no primeiro card.
    const contato = await criarContato(ORG_VIVA, "Contato 543134@lid");
    await pool.query("update contacts set phone_number = '+5531955554444' where id = $1", [
      contato,
    ]);
    const r = await garantirLeadDaConversa(db, {
      organizationId: ORG_VIVA,
      contactId: contato,
      conversationId: CONVERSA,
      nomeDoContato: "Contato 543134@lid",
    });
    expect(r.criado).toBe(true);
    if (!r.criado) return;
    const { rows } = await pool.query<{ title: string }>(
      "select title from crm_leads where id = $1",
      [r.leadId],
    );
    expect(rows[0]!.title).not.toMatch(/@lid|@c\.us/);
    // Cai no telefone, que é informação útil — melhor que "Sem nome".
    expect(rows[0]!.title).toBe("+5531955554444");
  });

  it("sem nome do contato, o título ainda é legível — nunca identificador técnico", async () => {
    const contato = await criarContato(ORG_VIVA, null);
    const r = await garantirLeadDaConversa(db, {
      organizationId: ORG_VIVA,
      contactId: contato,
      conversationId: CONVERSA,
      nomeDoContato: "   ",
    });
    expect(r.criado).toBe(true);
    if (!r.criado) return;

    const { rows } = await pool.query<{ title: string }>(
      "select title from crm_leads where id = $1",
      [r.leadId],
    );
    expect(rows[0]!.title).toBe("Novo contato pelo WhatsApp");
  });
});

describe("janela curta separa reenvio de demanda nova", () => {
  it("a segunda mensagem não abre um segundo card", async () => {
    const contato = await criarContato(ORG_VIVA, "Repetido Souza");
    const dados = {
      organizationId: ORG_VIVA,
      contactId: contato,
      conversationId: CONVERSA,
      nomeDoContato: "Repetido Souza",
    };

    const primeira = await garantirLeadDaConversa(db, dados);
    const segunda = await garantirLeadDaConversa(db, dados);

    expect(primeira.criado).toBe(true);
    expect(segunda.criado).toBe(false);
    if (segunda.criado) return;
    expect(segunda.motivo).toBe("janela_reenvio");
    expect(segunda.leadId).toBe(primeira.criado ? primeira.leadId : undefined);

    const { rows } = await pool.query<{ n: string }>(
      "select count(*) as n from crm_leads where contact_id = $1",
      [contato],
    );
    expect(rows[0]!.n, "um contato, um card dentro da janela").toBe("1");
    const atividades = await pool.query<{ n: string }>(
      "select count(*) as n from crm_lead_activities where lead_id = $1 and type = 'lead_merged'",
      [segunda.leadId],
    );
    expect(atividades.rows[0]!.n).toBe("1");
  });

  it("seis leituras liberadas juntas fazem seis INSERTs, uma criação e cinco colisões", async () => {
    const contato = await criarContato(ORG_VIVA, "Corrida Determinística");
    let leituras = 0;
    let tentativas = 0;
    let liberar!: () => void;
    const liberado = new Promise<void>((resolve) => {
      liberar = resolve;
    });
    const barreira = async () => {
      leituras += 1;
      if (leituras === 6) liberar();
      await liberado;
    };

    const resultados = await Promise.all(
      Array.from({ length: 6 }, (_, indice) =>
        garantirLeadDaConversa(db, {
          organizationId: ORG_VIVA,
          contactId: contato,
          conversationId: `1ead7e00-0000-4000-8000-${String(indice + 1).padStart(12, "0")}`,
          nomeDoContato: "Corrida Determinística",
          depoisDaLeituraDaJanela: barreira,
          aoTentarInsert: () => {
            tentativas += 1;
          },
        }),
      ),
    );

    expect(leituras, "todas concluíram a leitura antes da liberação").toBe(6);
    expect(tentativas, "todas chegaram ao INSERT depois da mesma leitura vazia").toBe(6);
    expect(resultados.filter((r) => r.criado)).toHaveLength(1);
    const colisoes = resultados.filter((r) => !r.criado && r.colisao === true);
    expect(colisoes).toHaveLength(5);

    const ids = new Set(resultados.map((r) => r.leadId));
    expect(ids.size).toBe(1);
    const cards = await pool.query<{ n: string }>(
      "select count(*) as n from crm_leads where contact_id = $1 and status = 'open'",
      [contato],
    );
    expect(cards.rows[0]!.n).toBe("1");
    const atividades = await pool.query<{ n: string }>(
      "select count(*) as n from crm_lead_activities where contact_id = $1 and type = 'lead_merged'",
      [contato],
    );
    expect(atividades.rows[0]!.n).toBe("5");
  });

  it("lead aberto em etapa posterior e fora da janela recebe a mensagem sem voltar ao início", async () => {
    const contato = await criarContato(ORG_VIVA, "Nova Demanda Oliveira");
    const leadId = await criarLeadExistente({
      contato,
      pipelineId: FUNIL_ENTRADA,
      stageId: ETAPA_POSTERIOR,
      titulo: "Nova Demanda Oliveira",
      criadoHa: "2 hours",
      position: 4321,
    });

    const r = await garantirLeadDaConversa(db, {
      organizationId: ORG_VIVA,
      contactId: contato,
      conversationId: CONVERSA,
      nomeDoContato: "Nova Demanda Oliveira",
    });

    expect(r).toMatchObject({ criado: false, motivo: "lead_aberto_existente", leadId });
    const { rows: leads } = await pool.query<{
      id: string;
      stage_id: string;
      status: string;
      position_in_stage: string;
    }>(
      `select id, stage_id, status, position_in_stage::text
         from crm_leads where contact_id = $1`,
      [contato],
    );
    expect(leads).toEqual([
      { id: leadId, stage_id: ETAPA_POSTERIOR, status: "open", position_in_stage: "4321" },
    ]);

    const { rows: atividades } = await pool.query<{ reason: string; source_id: string }>(
      `select reason, source_id from crm_lead_activities
        where lead_id = $1 and type = 'lead_merged'`,
      [leadId],
    );
    expect(atividades).toEqual([
      {
        reason: `A mensagem chegou e o lead já estava aberto na etapa ${NOME_ETAPA_POSTERIOR}.`,
        source_id: CONVERSA,
      },
    ]);
  });

  it("lead aberto vindo de formulário também recebe a mensagem no mesmo card", async () => {
    const contato = await criarContato(ORG_VIVA, "Formulário Andrade");
    const leadId = await criarLeadExistente({
      contato,
      pipelineId: FUNIL_ENTRADA,
      stageId: ETAPA_POSTERIOR,
      titulo: "Formulário Andrade",
      criadoHa: "10 minutes",
      source: "formulario",
      guardKey: "fonte:formulario-site",
    });

    const r = await garantirLeadDaConversa(db, {
      organizationId: ORG_VIVA,
      contactId: contato,
      conversationId: CONVERSA,
      nomeDoContato: "Formulário Andrade",
    });

    expect(r).toMatchObject({ criado: false, motivo: "lead_aberto_existente", leadId });
    const { rows: cards } = await pool.query<{ n: string }>(
      "select count(*) as n from crm_leads where contact_id = $1",
      [contato],
    );
    expect(cards[0]!.n).toBe("1");
    const { rows: atividades } = await pool.query<{ n: string }>(
      "select count(*) as n from crm_lead_activities where lead_id = $1 and type = 'lead_merged'",
      [leadId],
    );
    expect(atividades[0]!.n).toBe("1");
  });

  it.each(["won", "lost"] as const)("lead %s libera uma demanda nova", async (status) => {
    const contato = await criarContato(ORG_VIVA, `Fechado ${status}`);
    await criarLeadExistente({
      contato,
      pipelineId: FUNIL_ENTRADA,
      stageId: ETAPA_POSTERIOR,
      titulo: `Fechado ${status}`,
      criadoHa: "2 hours",
      status,
    });

    const r = await garantirLeadDaConversa(db, {
      organizationId: ORG_VIVA,
      contactId: contato,
      conversationId: CONVERSA,
      nomeDoContato: `Fechado ${status}`,
    });

    expect(r.criado, `negócio ${status} não bloqueia negócio novo`).toBe(true);
    const { rows } = await pool.query<{ n: string }>(
      "select count(*) as n from crm_leads where contact_id = $1",
      [contato],
    );
    expect(rows[0]!.n).toBe("2");
  });

  it("lead aberto em outro funil não bloqueia um card novo no funil de entrada", async () => {
    const contato = await criarContato(ORG_VIVA, "Outro Funil Lima");
    await criarLeadExistente({
      contato,
      pipelineId: OUTRO_FUNIL,
      stageId: ETAPA_OUTRO_FUNIL,
      titulo: "Outro Funil Lima",
      criadoHa: "2 hours",
    });

    const r = await garantirLeadDaConversa(db, {
      organizationId: ORG_VIVA,
      contactId: contato,
      conversationId: CONVERSA,
      nomeDoContato: "Outro Funil Lima",
    });

    expect(r.criado).toBe(true);
    if (!r.criado) return;
    expect(r.pipelineId).toBe(FUNIL_ENTRADA);
    const { rows } = await pool.query<{ pipeline_id: string }>(
      "select pipeline_id from crm_leads where contact_id = $1 order by created_at",
      [contato],
    );
    expect(rows.map((row) => row.pipeline_id).sort()).toEqual([FUNIL_ENTRADA, OUTRO_FUNIL].sort());
  });

  it("lead perdido ou ganho libera uma demanda nova: só o card ABERTO segura a mensagem", async () => {
    for (const status of ["lost", "won"] as const) {
      const contato = await criarContato(ORG_VIVA, `Fechado ${status} Prado`);
      const antigo = await criarLeadExistente({
        contato,
        pipelineId: FUNIL_ENTRADA,
        stageId: ETAPA_POSTERIOR,
        titulo: `Fechado ${status} Prado`,
        criadoHa: "3 days",
        status,
      });

      const r = await garantirLeadDaConversa(db, {
        organizationId: ORG_VIVA,
        contactId: contato,
        conversationId: CONVERSA,
        nomeDoContato: `Fechado ${status} Prado`,
      });

      expect(r.criado, `lead ${status} não pode segurar a mensagem`).toBe(true);
      if (!r.criado) return;
      expect(r.leadId).not.toBe(antigo);
      expect(r.stageId).toBe(ETAPA_ENTRADA);
      const { rows } = await pool.query<{ id: string; status: string }>(
        "select id, status from crm_leads where contact_id = $1 order by created_at",
        [contato],
      );
      expect(rows.map((row) => row.status)).toEqual([status, "open"]);
    }
  });

  it("false explícito mantém o comportamento antigo e cria outro card", async () => {
    const contato = await criarContato(ORG_VIVA, "Compatibilidade Souza");
    await criarLeadExistente({
      contato,
      pipelineId: FUNIL_ENTRADA,
      stageId: ETAPA_POSTERIOR,
      titulo: "Compatibilidade Souza",
      criadoHa: "2 hours",
    });
    await pool.query(
      `update organizations
          set settings = coalesce(settings, '{}'::jsonb) || '{"lead_reentry_reuse_open": false}'::jsonb
        where id = $1`,
      [ORG_VIVA],
    );

    try {
      const r = await garantirLeadDaConversa(db, {
        organizationId: ORG_VIVA,
        contactId: contato,
        conversationId: CONVERSA,
        nomeDoContato: "Compatibilidade Souza",
      });
      expect(r.criado).toBe(true);
      const { rows } = await pool.query<{ n: string }>(
        "select count(*) as n from crm_leads where contact_id = $1",
        [contato],
      );
      expect(rows[0]!.n).toBe("2");
    } finally {
      await pool.query(
        "update organizations set settings = settings - 'lead_reentry_reuse_open' where id = $1",
        [ORG_VIVA],
      );
    }
  });

  it("com dois leads abertos no funil de entrada, alimenta o mais recente por created_at", async () => {
    const contato = await criarContato(ORG_VIVA, "Dois Abertos Costa");
    const antigo = await criarLeadExistente({
      contato,
      pipelineId: FUNIL_ENTRADA,
      stageId: ETAPA_ENTRADA,
      titulo: "Antigo",
      criadoHa: "4 hours",
    });
    const recente = await criarLeadExistente({
      contato,
      pipelineId: FUNIL_ENTRADA,
      stageId: ETAPA_POSTERIOR,
      titulo: "Recente",
      criadoHa: "2 hours",
    });

    const r = await garantirLeadDaConversa(db, {
      organizationId: ORG_VIVA,
      contactId: contato,
      conversationId: CONVERSA,
      nomeDoContato: "Dois Abertos Costa",
    });

    expect(r).toMatchObject({ criado: false, motivo: "lead_aberto_existente", leadId: recente });
    const { rows } = await pool.query<{ lead_id: string }>(
      "select lead_id from crm_lead_activities where contact_id = $1 and type = 'lead_merged'",
      [contato],
    );
    expect(rows).toEqual([{ lead_id: recente }]);
    expect(rows[0]!.lead_id).not.toBe(antigo);
  });
});

describe("quando o lead NÃO nasce — e cada recusa diz por quê", () => {
  it("quem pediu para sair não vira oportunidade", async () => {
    const contato = await criarContato(ORG_VIVA, "Saiu Lima");
    await pool.query(
      "update contacts set is_blocked = true, blocked_reason = 'stop_keyword' where id = $1",
      [contato],
    );

    const r = await garantirLeadDaConversa(db, {
      organizationId: ORG_VIVA,
      contactId: contato,
      conversationId: CONVERSA,
      nomeDoContato: "Saiu Lima",
    });

    expect(r.criado).toBe(false);
    if (r.criado) return;
    expect(r.motivo).toBe("contato_bloqueado");

    const { rows } = await pool.query<{ n: string }>(
      "select count(*) as n from crm_leads where contact_id = $1",
      [contato],
    );
    expect(rows[0]!.n, "nenhum card para quem pediu para sair").toBe("0");
  });

  it("organização sem funil padrão recusa com motivo próprio — e não pega o do vizinho", async () => {
    // ORG_VIVA TEM funil padrão e existe neste mesmo banco. Se o filtro de
    // organização falhasse, este caso criaria um lead no funil dela — e é
    // exatamente o vazamento entre tenants que não pode passar.
    const contato = await criarContato(ORG_SEM_FUNIL, "Órfão Costa");
    const r = await garantirLeadDaConversa(db, {
      organizationId: ORG_SEM_FUNIL,
      contactId: contato,
      conversationId: CONVERSA,
      nomeDoContato: "Órfão Costa",
    });

    expect(r.criado).toBe(false);
    if (r.criado) return;
    expect(r.motivo).toBe("sem_funil_de_entrada");

    const { rows } = await pool.query<{ n: string }>(
      "select count(*) as n from crm_leads where contact_id = $1",
      [contato],
    );
    expect(rows[0]!.n).toBe("0");
  });

  it("funil só com etapas de ganho/perda recusa por FALTA DE ETAPA, não por falta de funil", async () => {
    // Os dois motivos apontam para consertos diferentes: um é "crie um funil",
    // o outro é "seu funil não tem onde entrar". Colapsá-los num só mandaria
    // quem configura procurar no lugar errado.
    const contato = await criarContato(ORG_SO_FECHADAS, "Sem Etapa Dias");
    const r = await garantirLeadDaConversa(db, {
      organizationId: ORG_SO_FECHADAS,
      contactId: contato,
      conversationId: CONVERSA,
      nomeDoContato: "Sem Etapa Dias",
    });

    expect(r.criado).toBe(false);
    if (r.criado) return;
    expect(r.motivo).toBe("sem_etapa");
  });
});

describe("a etapa de entrada nunca é uma etapa de fechamento", () => {
  it("funil com 'Ganho' na posição 0 ainda faz o lead nascer em 'Entrada'", async () => {
    // Um funil pode ser montado em qualquer ordem — é do dono do negócio. Se a
    // regra fosse só "menor position", este lead nasceria GANHO: um negócio
    // fechado que ninguém vendeu, poluindo qualquer métrica de conversão.
    const contato = await criarContato(ORG_GANHO_PRIMEIRO, "Torto Alves");
    const r = await garantirLeadDaConversa(db, {
      organizationId: ORG_GANHO_PRIMEIRO,
      contactId: contato,
      conversationId: CONVERSA,
      nomeDoContato: "Torto Alves",
    });

    expect(r.criado, `esperava criar, veio ${JSON.stringify(r)}`).toBe(true);
    if (!r.criado) return;

    const { rows } = await pool.query<{ name: string; is_won: boolean; is_lost: boolean }>(
      `select s.name, s.is_won, s.is_lost from crm_stages s
         join crm_leads l on l.stage_id = s.id where l.id = $1`,
      [r.leadId],
    );
    expect(rows[0]!.name).toBe("Entrada");
    expect(rows[0]!.is_won).toBe(false);
    expect(rows[0]!.is_lost).toBe(false);
  });
});
