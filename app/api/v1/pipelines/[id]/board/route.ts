import { AuthTemporariamenteIndisponivel } from "@/lib/auth/get-user-com-backoff";
import { comAuthDisponivel } from "@/lib/auth/api-disponivel";
import { getUserComBackoff } from "@/lib/auth/get-user-com-backoff";
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
import { createClient } from "@/lib/supabase/server";
import type {
  BoardData,
  BoardStageChunk,
  BoardStagePage,
  Pipeline,
  Stage,
} from "@/lib/kanban/types";
import type { Lead } from "@/lib/types/leads";

import { applyBoardDateRange, boardDateRange, validBoardDate, type BoardDateRange } from "@/lib/kanban/date-range";

import { enrichLeads } from "./enrich-leads";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

const STAGE_PAGE_SIZE = 50;

const querySchema = z
  .object({
    stage_id: z.string().min(1).max(128).optional(),
    cursor: z.string().min(1).max(512).optional(),
    date_field: z.enum(["created_at", "last_activity_at"]).optional(),
    date_from: z.string().refine(validBoardDate).optional(),
    date_until: z.string().refine(validBoardDate).optional(),
  })
  .refine((q) => !q.date_from || !q.date_until || q.date_from <= q.date_until, { path: ["date_until"] })
  .refine((query) => !query.cursor || query.stage_id, { path: ["cursor"] });

interface BoardCursor {
  position: number;
  id: string;
}

interface StageCountRow {
  stage_id: string;
  total: number | string;
}

function encodeBoardCursor(cursor: BoardCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeBoardCursor(raw: string): BoardCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as BoardCursor;
    if (!Number.isFinite(parsed.position) || typeof parsed.id !== "string") return null;
    return parsed;
  } catch (erroDeAuth) {
    if (erroDeAuth instanceof AuthTemporariamenteIndisponivel) throw erroDeAuth;
    return null;
  }
}

async function loadStagePage(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organizationId: string,
  pipelineId: string,
  stageId: string,
  cursor: BoardCursor | null,
  total: number,
  dates: BoardDateRange,
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

  pageQuery = applyBoardDateRange(pageQuery, dates);

  if (cursor) {
    pageQuery = pageQuery.or(
      `position_in_stage.gt.${cursor.position},and(position_in_stage.eq.${cursor.position},id.gt.${cursor.id})`,
    );
  }

  const pageResult = await pageQuery;

  if (pageResult.error) return { chunk: null, error: pageResult.error.message };

  const rows = (pageResult.data ?? []) as Lead[];
  const hasMore = rows.length > STAGE_PAGE_SIZE;
  const leads = hasMore ? rows.slice(0, STAGE_PAGE_SIZE) : rows;
  const last = leads[leads.length - 1];
  const next = hasMore ? rows[STAGE_PAGE_SIZE] : undefined;
  const page: BoardStagePage = {
    total,
    has_more: hasMore,
    cursor:
      hasMore && last
        ? encodeBoardCursor({ position: Number(last.position_in_stage), id: last.id })
        : null,
    next_position_in_stage: next ? Number(next.position_in_stage) : null,
  };

  return { chunk: { stage_id: stageId, leads, page }, error: null };
}

async function loadStageCounts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organizationId: string,
  pipelineId: string,
  stageIds: string[],
  dates: BoardDateRange,
): Promise<{ totals: Map<string, number>; error: string | null }> {
  if (dates.from || dates.before) {
    const counts = await Promise.all(stageIds.map(async (id) => {
      const query = supabase.from("crm_leads").select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId).eq("pipeline_id", pipelineId)
        .eq("stage_id", id).neq("status", "archived");
      const result = await applyBoardDateRange(query, dates);
      return { id, count: result.count ?? 0, error: result.error?.message };
    }));
    return { totals: new Map(counts.map((r) => [r.id, r.count])), error: counts.find((r) => r.error)?.error ?? null };
  }
  const result = await supabase.rpc("fn_contagem_por_etapa" as never, {
    p_organization_id: organizationId,
    p_pipeline_id: pipelineId,
  } as never);
  if (result.error) return { totals: new Map(), error: result.error.message };

  const rows = (result.data ?? []) as unknown as StageCountRow[];
  return {
    totals: new Map(rows.map((row) => [row.stage_id, Number(row.total)])),
    error: null,
  };
}

async function GETComAuth(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id: pipelineId } = await ctx.params;

  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await getUserComBackoff(() => supabase.auth.getUser());
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
  const dates = boardDateRange({ dateField: parsedQuery.data.date_field,
    dateFrom: parsedQuery.data.date_from, dateUntil: parsedQuery.data.date_until });
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
    const [countResult, pageResult] = await Promise.all([
      loadStageCounts(supabase, typedPipeline.organization_id, pipelineId, typedStages.map((s) => s.id), dates),
      loadStagePage(
        supabase,
        typedPipeline.organization_id,
        pipelineId,
        requestedStageId,
        cursor,
        0,
        dates,
      ),
    ]);
    if (countResult.error) {
      return fail("internal_error", countResult.error, 500, { requestId });
    }
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
    const chunk = {
      ...pageResult.chunk,
      page: {
        ...pageResult.chunk.page,
        total: countResult.totals.get(requestedStageId) ?? 0,
      },
    };
    const leadsComConversa = await enrichLeads(
      supabase,
      typedPipeline.organization_id,
      chunk.leads,
      defaultPipelineId,
    );
    if (leadsComConversa.error) {
      return fail("internal_error", leadsComConversa.error, 500, { requestId });
    }
    return ok<BoardStageChunk>(
      { ...chunk, leads: leadsComConversa.leads },
      { requestId },
    );
  }

  const [countResult, pageResults] = await Promise.all([
    loadStageCounts(supabase, typedPipeline.organization_id, pipelineId, typedStages.map((s) => s.id), dates),
    Promise.all(
      typedStages.map((stage) =>
        loadStagePage(supabase, typedPipeline.organization_id, pipelineId, stage.id, null, 0, dates),
      ),
    ),
  ]);
  if (countResult.error) return fail("internal_error", countResult.error, 500, { requestId });
  const pageError = pageResults.find((result) => result.error)?.error;
  if (pageError) return fail("internal_error", pageError, 500, { requestId });

  const chunks = pageResults.flatMap((result) =>
    result.chunk
      ? [
          {
            ...result.chunk,
            page: {
              ...result.chunk.page,
              total: countResult.totals.get(result.chunk.stage_id) ?? 0,
            },
          },
        ]
      : [],
  );
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

export const GET = comAuthDisponivel(GETComAuth);
