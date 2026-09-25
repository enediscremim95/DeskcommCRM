/**
 * GET /api/v1/pipelines/[id]/board
 *
 * Returns pipeline metadata, active stages and the first page of each column.
 * A request with `stage_id` + `cursor` returns the next page of that stage.
 * All reads are RLS-filtered to the caller's org via cookie session.
 *
 * Why this exists: previously useBoard hit supabase-js directly from the
 * browser. The auth cookie is httpOnly, which the browser Supabase client
 * cannot read — auth.uid() came back null and RLS dropped the pipeline row,
 * surfacing as PostgREST "Cannot coerce result to a single JSON object"
 * (PGRST116). Routing through the API ensures the server-side cookie reader
 * runs, same as every other authed query.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { loadAuthUser } from "@/lib/auth/server";
import { traduzir } from "@/lib/i18n/dicionario";
import {
  roteiaProximasAcoes,
  type EstadoDoContato,
  type PropostaAmbigua,
} from "@/lib/leads/next-action";
import type { LeadCandidate } from "@/lib/leads/active-lead";
import { createClient } from "@/lib/supabase/server";
import { queryInBatches } from "@/lib/supabase/query-in-batches";
import type {
  BoardData,
  BoardStageChunk,
  BoardStagePage,
  Pipeline,
  Stage,
} from "@/lib/kanban/types";
import type { Lead } from "@/lib/types/leads";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

const STAGE_PAGE_SIZE = 50;

const querySchema = z
  .object({
    stage_id: z.string().min(1).max(128).optional(),
    cursor: z.string().min(1).max(512).optional(),
  })
  .refine((query) => !query.cursor || query.stage_id, { path: ["cursor"] });

interface BoardCursor {
  position: number;
  id: string;
}

function encodeBoardCursor(cursor: BoardCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeBoardCursor(raw: string): BoardCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as BoardCursor;
    if (!Number.isFinite(parsed.position) || typeof parsed.id !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

async function loadStagePage(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organizationId: string,
  pipelineId: string,
  stageId: string,
  cursor: BoardCursor | null,
): Promise<{ chunk: BoardStageChunk | null; error: string | null }> {
  let pageQuery = supabase
    .from("crm_leads")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("pipeline_id", pipelineId)
    .eq("stage_id", stageId)
    .neq("status", "archived")
    .order("position_in_stage", { ascending: true })
    .order("id", { ascending: true })
    .limit(STAGE_PAGE_SIZE + 1);

  if (cursor) {
    pageQuery = pageQuery.or(
      `position_in_stage.gt.${cursor.position},and(position_in_stage.eq.${cursor.position},id.gt.${cursor.id})`,
    );
  }

  const [pageResult, countResult] = await Promise.all([
    pageQuery,
    supabase
      .from("crm_leads")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("pipeline_id", pipelineId)
      .eq("stage_id", stageId)
      .neq("status", "archived"),
  ]);

  if (pageResult.error) return { chunk: null, error: pageResult.error.message };
  if (countResult.error) return { chunk: null, error: countResult.error.message };

  const rows = (pageResult.data ?? []) as Lead[];
  const hasMore = rows.length > STAGE_PAGE_SIZE;
  const leads = hasMore ? rows.slice(0, STAGE_PAGE_SIZE) : rows;
  const last = leads[leads.length - 1];
  const next = hasMore ? rows[STAGE_PAGE_SIZE] : undefined;
  const page: BoardStagePage = {
    total: countResult.count ?? leads.length,
    has_more: hasMore,
    cursor:
      hasMore && last
        ? encodeBoardCursor({ position: Number(last.position_in_stage), id: last.id })
        : null,
    next_position_in_stage: next ? Number(next.position_in_stage) : null,
  };

  return { chunk: { stage_id: stageId, leads, page }, error: null };
}

/**
 * Anexa a identidade do agente dono (nome + versão publicada) aos leads que têm
 * `owner_kind='ai'`.
 *
 * **Sem filtro de `is_active`/`archived_at` de propósito.** Quem é o dono é
 * pergunta de EXIBIÇÃO e vale para qualquer agente: desativar um bot não pode
 * transformar os negócios dele em cards anônimos. A lista de agentes que PODEM
 * receber um lead (o picker, `/api/v1/ai/agents/assignable`) é outra pergunta e
 * lá os filtros estão certos.
 *
 * `organization_id` é filtrado explicitamente — vem do pipeline já validado pela
 * RLS do caller, nunca do body.
 */
async function withOwnerAgents(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organizationId: string,
  leads: Lead[],
): Promise<{ leads: Lead[]; error: string | null }> {
  const agentIds = [
    ...new Set(
      leads
        .filter((l) => l.owner_kind === "ai" && l.owner_agent_id)
        .map((l) => l.owner_agent_id as string),
    ),
  ];
  if (agentIds.length === 0) return { leads, error: null };

  const agentsResult = await queryInBatches<{
    id: string;
    name: string;
    published_version_id: string | null;
  }>(agentIds, (batch) =>
    supabase
      .from("ai_agents")
      .select("id, name, published_version_id")
      .eq("organization_id", organizationId)
      .in("id", batch),
  );
  if (agentsResult.error) return { leads, error: agentsResult.error };

  const agentRows = agentsResult.data;

  const publishedIds = agentRows.map((a) => a.published_version_id).filter((v): v is string => !!v);
  const versionById = new Map<string, number>();
  if (publishedIds.length > 0) {
    const versionsResult = await queryInBatches<{ id: string; version_number: number }>(
      publishedIds,
      (batch) =>
        supabase
          .from("ai_agent_versions")
          .select("id, version_number")
          .eq("organization_id", organizationId)
          .in("id", batch),
    );
    if (versionsResult.error) return { leads, error: versionsResult.error };
    for (const v of versionsResult.data) {
      versionById.set(v.id, v.version_number);
    }
  }

  const byId = new Map(agentRows.map((a) => [a.id, a]));
  return {
    leads: leads.map((lead) => {
      if (lead.owner_kind !== "ai" || !lead.owner_agent_id) return lead;
      const agent = byId.get(lead.owner_agent_id);
      if (!agent) return lead;
      return {
        ...lead,
        owner_agent: {
          id: agent.id,
          name: agent.name,
          version_number: agent.published_version_id
            ? (versionById.get(agent.published_version_id) ?? null)
            : null,
        },
      };
    }),
    error: null,
  };
}

/**
 * Anexa a próxima ação proposta pelo agente aos leads que a receberam.
 *
 * Os candidatos são buscados por CONTATO na org inteira, e não só neste
 * pipeline: `resolveActiveLeadForContact` precisa enxergar todos os negócios
 * abertos da pessoa para poder chamar de ambíguo o que é ambíguo. Recortando a
 * lista por pipeline, dois negócios ambíguos em boards diferentes apareceriam
 * como um único negócio em cada board, e os dois exibiriam a mesma proposta.
 */
/**
 * Abre um item de caixa por proposta sem dono — no máximo um por contato.
 *
 * Deduplicado por (kind, ref_id, status='open') porque o board é lido a cada
 * refresh: sem isto, um contato ambíguo produziria um item por render até a
 * caixa virar ruído e ninguém mais olhar.
 *
 * Falha aqui NÃO derruba o board: o aviso é importante, mas menos que a tela
 * abrir. O erro sobe para o Sentry pelo caminho normal de exceção não tratada
 * do handler — o que não pode é o usuário perder o board por causa do aviso.
 */
async function avisaAmbiguas(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organizationId: string,
  ambiguas: PropostaAmbigua[],
): Promise<void> {
  if (ambiguas.length === 0) return;

  const jaAbertosResult = await queryInBatches<{ ref_id: string }>(
    ambiguas.map((a) => a.contact_id),
    (batch) =>
      supabase
        .from("agent_inbox_items")
        .select("ref_id")
        .eq("organization_id", organizationId)
        .eq("kind", "next_action_ambiguous")
        .eq("status", "open")
        .in("ref_id", batch),
  );
  const abertos = new Set(jaAbertosResult.data.map((r) => r.ref_id));

  const novos = ambiguas
    .filter((a) => !abertos.has(a.contact_id))
    .map((a) => ({
      organization_id: organizationId,
      kind: "next_action_ambiguous",
      severity: "warn",
      title: `A IA propôs uma próxima ação, mas o contato tem ${a.candidateIds.length} negócios abertos`,
      body: `Proposta: "${a.texto}". Escolha a qual negócio ela pertence, o sistema não adivinha para não executar no negócio errado.`,
      ref_kind: "contact",
      ref_id: a.contact_id,
      status: "open",
    }));
  if (novos.length === 0) return;

  await supabase.from("agent_inbox_items").insert(novos);
}

/**
 * Anexa o score aos leads que o têm — LEFT JOIN, nunca INNER.
 *
 * Score ausente é estado legítimo (sinal insuficiente, cenário 17). Um INNER
 * apagaria do quadro justamente os leads sem sinal, que são os que mais
 * precisam de atenção humana — o oposto do que o produto existe para fazer.
 *
 * A faixa vem PERSISTIDA e é entregue como está: recalculá-la aqui (ou na UI)
 * ignoraria a histerese e devolveria o card piscando na fronteira, no único
 * lugar onde o CHECK de coerência não alcança.
 */
async function withScores(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organizationId: string,
  leads: Lead[],
): Promise<{ leads: Lead[]; error: string | null }> {
  if (leads.length === 0) return { leads, error: null };

  const result = await queryInBatches<{
    lead_id: string;
    ai_probability: number | string | null;
    ai_probability_reason: string | null;
    ai_probability_band: string | null;
    ai_probability_evidence: { factors?: unknown } | null;
    ai_probability_at: string | null;
  }>(
    leads.map((lead) => lead.id),
    (batch) =>
      supabase
        .from("crm_lead_scores")
        .select(
          "lead_id, ai_probability, ai_probability_reason, ai_probability_band, ai_probability_evidence, ai_probability_at",
        )
        .eq("organization_id", organizationId)
        .in("lead_id", batch),
  );
  if (result.error) return { leads, error: result.error };

  const porLead = new Map<string, NonNullable<Lead["score"]>>();
  for (const row of result.data) {
    // `numeric` chega como string no supabase-js; `null` continua null — e a
    // diferença entre null e 0 é justamente o que não pode se perder aqui.
    if (row.ai_probability === null || row.ai_probability_band === null) continue;
    const factors = Array.isArray(row.ai_probability_evidence?.factors)
      ? (row.ai_probability_evidence.factors as NonNullable<Lead["score"]>["factors"])
      : [];
    porLead.set(row.lead_id, {
      probability: Number(row.ai_probability),
      reason: row.ai_probability_reason ?? "",
      band: row.ai_probability_band as NonNullable<Lead["score"]>["band"],
      factors,
      at: row.ai_probability_at,
    });
  }

  return {
    leads: leads.map((lead) => {
      const score = porLead.get(lead.id);
      return score ? { ...lead, score } : lead;
    }),
    error: null,
  };
}

/**
 * Anexa a conversa mais recente do contato — o atalho do quadro para o inbox.
 *
 * LEFT, como o score: lead sem contato (criado à mão, vindo de webhook) e
 * contato sem conversa são estados normais, e sumir com esses cards do quadro
 * seria esconder justamente os que ninguém atendeu ainda.
 *
 * A MAIS RECENTE por contato, não todas: o card mostra uma linha, e escolher na
 * UI exigiria trazer o histórico inteiro de cada lead para descartar quase tudo.
 *
 * Ordena por `last_message_at` e fica com a primeira de cada contato — as
 * conversas já vêm ordenadas, então o primeiro visto é o mais recente.
 */
async function withConversas(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organizationId: string,
  leads: Lead[],
): Promise<{ leads: Lead[]; error: string | null }> {
  const contactIds = [...new Set(leads.map((l) => l.contact_id).filter((c): c is string => !!c))];
  if (contactIds.length === 0) return { leads, error: null };

  const result = await queryInBatches<{
    id: string;
    contact_id: string;
    last_message_preview: string | null;
    last_message_at: string | null;
    unread_count_for_assignee: number | null;
  }>(contactIds, (batch) =>
    supabase
      .from("conversations")
      .select("id, contact_id, last_message_preview, last_message_at, unread_count_for_assignee")
      .eq("organization_id", organizationId)
      .in("contact_id", batch)
      .order("last_message_at", { ascending: false, nullsFirst: false }),
  );
  if (result.error) return { leads, error: result.error };

  const porContato = new Map<string, NonNullable<Lead["conversa"]>>();
  for (const row of result.data) {
    // Primeira vista vence: a consulta já veio ordenada por atividade.
    if (porContato.has(row.contact_id)) continue;
    porContato.set(row.contact_id, {
      id: row.id,
      preview: row.last_message_preview,
      last_message_at: row.last_message_at,
      unread: row.unread_count_for_assignee ?? 0,
    });
  }

  return {
    leads: leads.map((lead) => {
      const conversa = lead.contact_id ? porContato.get(lead.contact_id) : undefined;
      return conversa ? { ...lead, conversa } : lead;
    }),
    error: null,
  };
}

async function withNextActions(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organizationId: string,
  leads: Lead[],
  defaultPipelineId: string | null,
): Promise<{ leads: Lead[]; error: string | null }> {
  const contactIds = [...new Set(leads.map((l) => l.contact_id).filter((c): c is string => !!c))];
  if (contactIds.length === 0) return { leads, error: null };

  const [estadosResult, candidatosResult] = await Promise.all([
    queryInBatches<EstadoDoContato>(contactIds, (batch) =>
      supabase
        .from("lead_state")
        .select("contact_id, next_action, next_action_seq, updated_at")
        .eq("organization_id", organizationId)
        .in("contact_id", batch)
        .not("next_action", "is", null),
    ),
    queryInBatches<LeadCandidate & { contact_id: string | null }>(contactIds, (batch) =>
      supabase
        .from("crm_leads")
        .select(
          "id, organization_id, pipeline_id, status, last_activity_at, created_at, contact_id",
        )
        .eq("organization_id", organizationId)
        .eq("status", "open")
        .in("contact_id", batch),
    ),
  ]);
  if (estadosResult.error) return { leads, error: estadosResult.error };
  if (candidatosResult.error) return { leads, error: candidatosResult.error };
  if (estadosResult.data.length === 0) return { leads, error: null };

  const { porLead, ambiguas } = roteiaProximasAcoes(estadosResult.data, candidatosResult.data, {
    defaultPipelineId,
  });

  // Recusar o palpite não pode virar silêncio: a proposta que não achou dono vai
  // para a caixa, onde um humano desambigua. Escrever a partir de um GET não é
  // bonito, e é deliberado — a ambiguidade só EXISTE quando se olha o conjunto
  // de negócios abertos AGORA, e é aqui que esse olhar acontece. Fazer no
  // momento da escrita da proposta perderia o caso em que o segundo negócio
  // nasce depois dela.
  await avisaAmbiguas(supabase, organizationId, ambiguas);

  if (porLead.size === 0) return { leads, error: null };

  return {
    leads: leads.map((lead) => {
      const acao = porLead.get(lead.id);
      return acao ? { ...lead, next_action: acao } : lead;
    }),
    error: null,
  };
}

async function enrichLeads(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organizationId: string,
  leads: Lead[],
  defaultPipelineId: string | null,
): Promise<{ leads: Lead[]; error: string | null }> {
  const leadsWithOwner = await withOwnerAgents(supabase, organizationId, leads);
  if (leadsWithOwner.error) return leadsWithOwner;

  const leadsComAcao = await withNextActions(
    supabase,
    organizationId,
    leadsWithOwner.leads,
    defaultPipelineId,
  );
  if (leadsComAcao.error) return leadsComAcao;

  const leadsComScore = await withScores(supabase, organizationId, leadsComAcao.leads);
  if (leadsComScore.error) return leadsComScore;

  const leadsComConversa = await withConversas(supabase, organizationId, leadsComScore.leads);
  return leadsComConversa;
}

export async function GET(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id: pipelineId } = await ctx.params;

  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return fail("unauthenticated", "Auth required.", 401, { requestId });
  }
  const authUser = await loadAuthUser();
  const t = (texto: string) => traduzir(texto, authUser?.idioma ?? "pt-BR");

  const parsedQuery = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams.entries()));
  if (!parsedQuery.success) {
    return fail("validation_failed", t("Parâmetros de paginação inválidos."), 400, {
      requestId,
      details: parsedQuery.error.flatten(),
    });
  }
  const rawCursor = parsedQuery.data.cursor;
  const cursor = rawCursor ? decodeBoardCursor(rawCursor) : null;
  if (rawCursor && !cursor) {
    return fail("invalid_cursor", t("Cursor inválido."), 400, { requestId });
  }

  const [{ data: pipeline, error: pipelineErr }, { data: stages, error: stagesErr }] =
    await Promise.all([
      supabase.from("crm_pipelines").select("*").eq("id", pipelineId).maybeSingle(),
      supabase
        .from("crm_stages")
        .select("*")
        .eq("pipeline_id", pipelineId)
        .eq("is_archived", false)
        .order("position"),
    ]);

  if (pipelineErr) return fail("internal_error", pipelineErr.message, 500, { requestId });
  if (stagesErr) return fail("internal_error", stagesErr.message, 500, { requestId });
  if (!pipeline)
    return fail("resource_not_found", t("Pipeline não encontrado."), 404, { requestId });

  const typedPipeline = pipeline as Pipeline;
  const typedStages = (stages ?? []) as Stage[];
  const requestedStageId = parsedQuery.data.stage_id;
  if (requestedStageId && !typedStages.some((stage) => stage.id === requestedStageId)) {
    return fail("resource_not_found", t("Etapa não encontrada neste funil."), 404, {
      requestId,
    });
  }

  const { data: pipelinePadrao } = await supabase
    .from("crm_pipelines")
    .select("id")
    .eq("organization_id", typedPipeline.organization_id)
    .eq("is_default", true)
    .maybeSingle();
  const defaultPipelineId = (pipelinePadrao as { id: string } | null)?.id ?? null;

  if (requestedStageId) {
    const pageResult = await loadStagePage(
      supabase,
      typedPipeline.organization_id,
      pipelineId,
      requestedStageId,
      cursor,
    );
    if (pageResult.error || !pageResult.chunk) {
      return fail(
        "internal_error",
        pageResult.error ?? t("Não foi possível carregar a etapa."),
        500,
        {
          requestId,
        },
      );
    }
    const leadsComConversa = await enrichLeads(
      supabase,
      typedPipeline.organization_id,
      pageResult.chunk.leads,
      defaultPipelineId,
    );
    if (leadsComConversa.error) {
      return fail("internal_error", leadsComConversa.error, 500, { requestId });
    }
    return ok<BoardStageChunk>(
      { ...pageResult.chunk, leads: leadsComConversa.leads },
      { requestId },
    );
  }

  const pageResults = await Promise.all(
    typedStages.map((stage) =>
      loadStagePage(supabase, typedPipeline.organization_id, pipelineId, stage.id, null),
    ),
  );
  const pageError = pageResults.find((result) => result.error)?.error;
  if (pageError) return fail("internal_error", pageError, 500, { requestId });

  const chunks = pageResults.flatMap((result) => (result.chunk ? [result.chunk] : []));
  const firstLeads = chunks.flatMap((chunk) => chunk.leads);
  const leadsComConversa = await enrichLeads(
    supabase,
    typedPipeline.organization_id,
    firstLeads,
    defaultPipelineId,
  );
  if (leadsComConversa.error) {
    return fail("internal_error", leadsComConversa.error, 500, { requestId });
  }
  const stagePages = Object.fromEntries(chunks.map((chunk) => [chunk.stage_id, chunk.page]));

  const board: BoardData = {
    pipeline: typedPipeline,
    stages: typedStages,
    leads: leadsComConversa.leads,
    stage_pages: stagePages,
  };

  return ok(board, { requestId });
}
