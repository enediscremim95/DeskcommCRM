/**
 * GET /api/v1/pipelines/entry-options
 *
 * Fonte da verdade da tela que configura onde um lead nasce. O destino
 * automático vem de `funilDeEntrada`; as alternativas seguem exatamente a
 * mesma régua e já saem filtradas daqui. Assim, nenhum componente precisa
 * reinterpretar `is_won`, `is_lost` ou `is_archived`.
 */
import { randomUUID } from "node:crypto";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import type { PipelineVocabulary } from "@/lib/kanban/types";
import { funilDeEntrada } from "@/lib/leads/nascimento-do-lead";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface EtapaDeEntrada {
  id: string;
  name: string;
  position: number;
}

interface FunilDeEntrada {
  id: string;
  name: string;
  position: number;
  is_default: boolean;
  vocabulary: PipelineVocabulary | null;
  stages: EtapaDeEntrada[];
}

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", {
    requestId,
    resource: "crm_pipelines",
  });
  if (!authz.ok) return authz.response;

  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const organizationId = authz.org.orgId;
  const supabase = await createClient();

  const { data: pipelines, error: pipelinesError } = await supabase
    .from("crm_pipelines")
    .select("id, name, position, is_default, vocabulary")
    .eq("organization_id", organizationId)
    .eq("is_archived", false)
    .order("position", { ascending: true });

  if (pipelinesError) {
    return fail("internal_error", t("Falha ao listar funis."), 500, {
      requestId,
      details: pipelinesError.message,
    });
  }

  const funisAtivos = (pipelines ?? []) as Array<Omit<FunilDeEntrada, "stages">>;
  if (funisAtivos.length === 0) {
    return ok({ pipelines: [], default_pipeline_id: null, default_stage_id: null }, { requestId });
  }

  const [{ data: stages, error: stagesError }, destinoAutomatico] = await Promise.all([
    supabase
      .from("crm_stages")
      .select("id, pipeline_id, name, position")
      .eq("organization_id", organizationId)
      .in(
        "pipeline_id",
        funisAtivos.map((pipeline) => pipeline.id),
      )
      .eq("is_archived", false)
      .eq("is_won", false)
      .eq("is_lost", false)
      .order("position", { ascending: true }),
    funilDeEntrada(supabase, organizationId),
  ]);

  if (stagesError) {
    return fail("internal_error", t("Falha ao listar etapas."), 500, {
      requestId,
      details: stagesError.message,
    });
  }

  const etapas = (stages ?? []) as Array<EtapaDeEntrada & { pipeline_id: string }>;
  const resposta: FunilDeEntrada[] = funisAtivos.map((pipeline) => ({
    ...pipeline,
    stages: etapas
      .filter((stage) => stage.pipeline_id === pipeline.id)
      .map(({ id, name, position }) => ({ id, name, position })),
  }));
  const funilPadrao = resposta.find((pipeline) => pipeline.is_default) ?? null;

  return ok(
    {
      pipelines: resposta,
      default_pipeline_id: funilPadrao?.id ?? null,
      default_stage_id: "erro" in destinoAutomatico ? null : destinoAutomatico.stageId,
    },
    { requestId },
  );
}
