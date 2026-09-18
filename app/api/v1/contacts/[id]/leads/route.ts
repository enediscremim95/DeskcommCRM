import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { camposDoFunil, settingsDoEmbed } from "@/lib/leads/campos-do-funil";
import { createClient } from "@/lib/supabase/server";
import type { LeadComContexto } from "@/lib/types/leads";

export const dynamic = "force-dynamic";

const COLUNAS = "*, pipeline:crm_pipelines(name, settings), stage:crm_stages(name)";

function relacaoUnica(valor: unknown): Record<string, unknown> | null {
  const candidato = Array.isArray(valor) ? valor[0] : valor;
  return candidato && typeof candidato === "object" ? (candidato as Record<string, unknown>) : null;
}

/** Todos os negócios do contato ativo, sem assumir funil nem conjunto de campos. */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id: contactId } = await ctx.params;
  const authz = await requireRole("viewer", { requestId, resource: "crm_leads" });
  if (!authz.ok) return authz.response;

  const supabase = await createClient();
  const { data: contact, error: contactError } = await supabase
    .from("contacts")
    .select("id")
    .eq("organization_id", authz.org.orgId)
    .eq("id", contactId)
    .maybeSingle();
  if (contactError) return fail("internal_error", contactError.message, 500, { requestId });
  if (!contact) return fail("not_found", "Contato não encontrado.", 404, { requestId });

  const { data, error } = await supabase
    .from("crm_leads")
    .select(COLUNAS)
    .eq("organization_id", authz.org.orgId)
    .eq("contact_id", contactId)
    .order("created_at", { ascending: false });
  if (error) return fail("internal_error", error.message, 500, { requestId });

  const leads = (data ?? []).map((row) => {
    const registro = row as Record<string, unknown>;
    const pipeline = relacaoUnica(registro.pipeline);
    const stage = relacaoUnica(registro.stage);
    const { pipeline: _pipeline, stage: _stage, ...lead } = registro;
    return {
      ...lead,
      pipeline_name: typeof pipeline?.name === "string" ? pipeline.name : "Não informado",
      stage_name: typeof stage?.name === "string" ? stage.name : "Não informado",
      field_defs: camposDoFunil(settingsDoEmbed(pipeline)),
    } as unknown as LeadComContexto;
  });

  return ok(leads, { requestId });
}
