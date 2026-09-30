import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { autenticarExtensao } from "@/lib/browser-extension/auth";
import { comCorsDaExtensao, respostaPreflightDaExtensao } from "@/lib/browser-extension/cors";
import { encontrarContatoPorTelefoneComNome } from "@/lib/channels/contato-por-telefone";

const querySchema = z
  .string()
  .trim()
  .regex(/^\+?\d{8,15}$/);
export const dynamic = "force-dynamic";
export const OPTIONS = respostaPreflightDaExtensao;

export async function GET(req: NextRequest): Promise<Response> {
  const authn = await autenticarExtensao(req);
  if (!authn.ok) return comCorsDaExtensao(authn.response);
  const parsed = querySchema.safeParse(req.nextUrl.searchParams.get("phone") ?? "");
  if (!parsed.success)
    return comCorsDaExtensao(fail("validation_failed", "Telefone inválido.", 422));
  const { admin, organizationId } = authn.auth;
  const contato = await encontrarContatoPorTelefoneComNome(admin, organizationId, parsed.data);
  if (!contato) return comCorsDaExtensao(ok({ contact: null, lead: null, notes: [], stages: [] }));

  const { data: lead } = await admin
    .from("crm_leads")
    .select("id, title, status, source, pipeline_id, stage_id, updated_at, crm_stages(name)")
    .eq("organization_id", organizationId)
    .eq("contact_id", contato.id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const [notes, stages] = await Promise.all([
    admin
      .from("lead_notes")
      .select("id, headline, body, created_at")
      .eq("organization_id", organizationId)
      .eq("contact_id", contato.id)
      .order("created_at", { ascending: false })
      .limit(3),
    lead?.pipeline_id
      ? admin
          .from("crm_stages")
          .select("id, name, position")
          .eq("organization_id", organizationId)
          .eq("pipeline_id", lead.pipeline_id)
          .order("position", { ascending: true })
      : Promise.resolve({
          data: [] as Array<{ id: string; name: string; position: number }>,
          error: null,
        }),
  ]);
  if (notes.error || stages.error)
    return comCorsDaExtensao(fail("internal_error", "Erro ao carregar o lead.", 500));
  const stageEmbed = lead?.crm_stages as { name?: string } | Array<{ name?: string }> | null;
  const stageName = Array.isArray(stageEmbed) ? stageEmbed[0]?.name : stageEmbed?.name;
  return comCorsDaExtensao(
    ok({
      contact: { id: contato.id, name: contato.name, phone_number: contato.phone_number },
      lead: lead
        ? {
            id: lead.id,
            title: lead.title,
            status: lead.status,
            source: lead.source,
            stage_id: lead.stage_id,
            stage_name: stageName ?? null,
            updated_at: lead.updated_at,
          }
        : null,
      notes: notes.data ?? [],
      stages: stages.data ?? [],
    }),
  );
}
