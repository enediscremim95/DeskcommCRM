import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { moveLeadHandler } from "@/app/api/v1/leads/_handler";
import { ApiError } from "@/lib/api/types";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { adiarAteAJanelaAbrir } from "@/lib/automation/janela-do-canal";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { registraFalhaDeAtividade } from "@/lib/leads/activity-write-failure";
import {
  estadoDaAprovacao,
  leUltimaRespostaDoContato,
  resolveConfiguracaoFollowupAprovavel,
} from "@/lib/leads/followup-aprovavel";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { traduzir } from "@/lib/i18n/dicionario";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

const Body = z.object({
  decision: z.enum(["accept", "dismiss"]),
  proposal_id: z.string().uuid(),
});

async function reabreProposta(
  supabase: Awaited<ReturnType<typeof createClient>>,
  proposalId: string,
  organizationId: string,
) {
  await supabase
    .from("crm_lead_reactivations")
    .update({ status: "pending", decided_at: null, decided_by_user_id: null })
    .eq("id", proposalId)
    .eq("organization_id", organizationId);
}

/** Aprovar move o lead; o evento de etapa aciona a mensagem fixa configurada. */
export async function POST(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const { id: leadId } = await ctx.params;
  const guard = await requireRole("agent", { requestId });
  if (!guard.ok) return guard.response;
  const t = (texto: string) => traduzir(texto, guard.user.idioma);
  const orgId = guard.org.orgId;
  const userId = guard.user.id;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("invalid_body", t("decision e proposal_id são obrigatórios."), 400, { requestId });
  }
  const { decision, proposal_id } = parsed.data;
  const supabase = await createClient();
  const decidedAt = new Date().toISOString();

  const { data: decidida, error } = await supabase
    .from("crm_lead_reactivations")
    .update({
      status: decision === "accept" ? "accepted" : "dismissed",
      decided_at: decidedAt,
      decided_by_user_id: userId,
    })
    .eq("id", proposal_id)
    .eq("lead_id", leadId)
    .eq("organization_id", orgId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (error) return fail("internal_error", error.message, 500, { requestId });
  if (!decidida) {
    const { data: existe } = await supabase
      .from("crm_lead_reactivations")
      .select("status")
      .eq("id", proposal_id)
      .eq("lead_id", leadId)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (existe) {
      return fail(
        "reactivation_not_pending",
        `${t("Esta sugestão já foi")} ${
          (existe as { status: string }).status === "expired"
            ? t("encerrada pelo prazo")
            : t("decidida")
        }.`,
        409,
        { requestId },
      );
    }
    return fail("not_found", t("Sugestão não encontrada."), 404, { requestId });
  }

  const { data: lead } = await supabase
    .from("crm_leads")
    .select("contact_id, pipeline_id, stage_id, updated_at")
    .eq("id", leadId)
    .eq("organization_id", orgId)
    .maybeSingle();
  const leadRow = lead as {
    contact_id: string | null;
    pipeline_id: string;
    stage_id: string;
    updated_at: string;
  } | null;

  if (!leadRow?.contact_id) {
    await reabreProposta(supabase, proposal_id, orgId);
    return fail("not_found", t("Lead ou contato não encontrado."), 404, { requestId });
  }

  let lastInboundAt: string | null;
  try {
    lastInboundAt = await leUltimaRespostaDoContato(supabase, orgId, leadRow.contact_id);
  } catch {
    await reabreProposta(supabase, proposal_id, orgId);
    return fail(
      "internal_error",
      t("Não foi possível conferir a resposta mais recente do contato."),
      500,
      { requestId },
    );
  }

  let delivery: ReturnType<typeof estadoDaAprovacao> | null = null;
  if (decision === "accept") {
    try {
      const config = await resolveConfiguracaoFollowupAprovavel(
        supabase,
        orgId,
        leadRow.pipeline_id,
      );
      if (!config) {
        await reabreProposta(supabase, proposal_id, orgId);
        return fail(
          "followup_approval_not_configured",
          t("Configure uma automação ativa com etapa de destino e mensagem fixa antes de aprovar."),
          409,
          { requestId },
        );
      }

      const proximaAbertura = await adiarAteAJanelaAbrir(
        supabase,
        orgId,
        config.channelSessionId,
      );
      delivery = estadoDaAprovacao(proximaAbertura);

      // Grava a fotografia antes do efeito externo. Se esta escrita falhar, o
      // lead não muda de etapa e a mensagem não corre o risco de duplicar.
      const { error: snapshotError } = await supabase
        .from("crm_lead_reactivations")
        .update({
          automation_rule_id: config.automationRuleId,
          stage_id_at_proposal: config.targetStageId,
          last_inbound_at_at_proposal: lastInboundAt,
        })
        .eq("id", proposal_id)
        .eq("organization_id", orgId);
      if (snapshotError) throw snapshotError;

      await moveLeadHandler(
        supabase,
        {
          organization_id: orgId,
          actor: { type: "user", id: userId },
          requestId,
          idioma: guard.user.idioma,
        },
        leadId,
        {
          to_stage_id: config.targetStageId,
          expected_updated_at: leadRow.updated_at,
          reason: "Follow-up aprovado na Central de avisos",
        },
      );
    } catch (err) {
      await reabreProposta(supabase, proposal_id, orgId);
      if (err instanceof ApiError) {
        return fail(err.code, err.message, err.status, {
          details: err.details,
          requestId,
        });
      }
      throw err;
    }
  } else {
    // A recusa passa a valer contra os fatos vistos NO CLIQUE. Uma resposta ou
    // mudança anterior à decisão não pode ressuscitar o mesmo aviso no próximo tick.
    const { error: snapshotError } = await supabase
      .from("crm_lead_reactivations")
      .update({
        stage_id_at_proposal: leadRow.stage_id,
        last_inbound_at_at_proposal: lastInboundAt,
      })
      .eq("id", proposal_id)
      .eq("organization_id", orgId);
    if (snapshotError) {
      await reabreProposta(supabase, proposal_id, orgId);
      return fail(
        "internal_error",
        t("Não foi possível registrar os fatos desta decisão."),
        500,
        { requestId },
      );
    }
  }

  const atividade = await emitLeadActivity(supabase, {
    organizationId: orgId,
    leadId,
    contactId: leadRow?.contact_id ?? null,
    type: decision === "accept" ? "reactivation_accepted" : "reactivation_dismissed",
    sourceModule: "crm",
    sourceId: leadId,
    actor: { type: "user", id: userId },
    reason:
      decision === "accept"
        ? "Retomada de contato aprovada"
        : "Retomada de contato descartada, decisão registrada",
    payload: { proposal_id },
  });
  if (!atividade.ok) {
    await registraFalhaDeAtividade(supabase, {
      organizationId: orgId,
      leadId,
      tipo: decision === "accept" ? "reactivation_accepted" : "reactivation_dismissed",
      origem: "api/v1/leads/[id]/reactivation",
      erro: atividade.error,
      requestId,
    });
    return fail(
      "activity_write_failed",
      t("A decisão não pôde ser registrada. Confira o negócio antes de tentar novamente."),
      500,
      { requestId },
    );
  }

  await supabase
    .from("agent_inbox_items")
    .update({ status: "resolved", resolved_at: decidedAt })
    .eq("organization_id", orgId)
    .eq("kind", "followup_suggestion")
    .eq("ref_kind", "lead")
    .eq("ref_id", leadId)
    .eq("status", "open")
    .contains("metadata", { proposal_id });

  return ok(
    {
      id: (decidida as { id: string }).id,
      status: decision === "accept" ? "accepted" : "dismissed",
      delivery_status: delivery?.delivery_status ?? null,
      scheduled_for: delivery?.scheduled_for ?? null,
    },
    { requestId },
  );
}
