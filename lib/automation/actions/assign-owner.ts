/**
 * Ação `assign_owner` — valida membership ativa na org (tabela
 * `user_organizations`, `revoked_at is null`, role acima de viewer — doutrina
 * G3-04: responsável tem que ser atendente ativo) e seta owner_user_id +
 * assigned_at do lead do contexto.
 */
import { registerAction } from "@/lib/automation/actions";
import type { ActionCtx, ActionResultDetail } from "@/lib/automation/types";

async function execute(ctx: ActionCtx, config: Record<string, unknown>): Promise<ActionResultDetail> {
  const userId = typeof config.user_id === "string" ? config.user_id : null;
  let lead = ctx.context.lead as { id: string } | undefined;
  const contact = ctx.context.contact as { id?: string } | undefined;
  if (!userId) return { type: "assign_owner", status: "skipped", detail: { reason: "missing_input" } };

  // Em `message.received` o contexto parte do contato. Só assume o negócio se
  // houver exatamente um aberto: escolher entre dois seria trocar o dono do
  // card errado, que é pior que registrar a ambiguidade para revisão.
  if (!lead && contact?.id) {
    const { data: existentes, error: buscaErro } = await ctx.admin
      .from("crm_leads")
      .select("id")
      .eq("organization_id", ctx.organizationId)
      .eq("contact_id", contact.id)
      .eq("status", "open");
    if (buscaErro) return { type: "assign_owner", status: "failed", error: buscaErro.message };
    if ((existentes?.length ?? 0) > 1) {
      return { type: "assign_owner", status: "failed", error: "ambiguous_open_leads" };
    }
    if (existentes?.[0]) lead = existentes[0] as { id: string };
  }
  if (!lead) return { type: "assign_owner", status: "skipped", detail: { reason: "missing_input" } };

  const { data: member } = await ctx.admin
    .from("user_organizations")
    .select("user_id, role")
    .eq("organization_id", ctx.organizationId)
    .eq("user_id", userId)
    .is("revoked_at", null)
    .maybeSingle();
  if (!member) return { type: "assign_owner", status: "failed", error: "user_not_in_org" };
  if (member.role === "viewer") {
    // Mesma régua do bulk-assign (G3-04 invalid_owner): viewer não atende.
    return { type: "assign_owner", status: "failed", error: "invalid_owner" };
  }

  const conversationIdFromEvent =
    typeof ctx.event.payload.conversation_id === "string"
      ? ctx.event.payload.conversation_id
      : null;
  let conversationId = conversationIdFromEvent;
  if (!conversationId && contact?.id) {
    const { data: conversa } = await ctx.admin
      .from("conversations")
      .select("id")
      .eq("organization_id", ctx.organizationId)
      .eq("contact_id", contact.id)
      .in("status", ["open", "pending", "claimed", "ai_handling"])
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    conversationId = conversa?.id ?? null;
  }

  // Atribuir só o lead não interrompe quem responde no WhatsApp. A RPC é o
  // caminho canônico que atribui a conversa e silencia o automático no mesmo
  // ato. Se não há conversa, a ação continua válida para um lead sem chat.
  if (conversationId) {
    const { error: assignmentError } = await ctx.admin.rpc("fn_conversation_assign", {
      p_organization_id: ctx.organizationId,
      p_conversation_id: conversationId,
      p_to_user_id: userId,
      p_reason: "handoff",
      p_expected_assignee: null,
      p_enforce_expected: false,
    });
    if (assignmentError) {
      return { type: "assign_owner", status: "failed", error: assignmentError.message };
    }
  }

  const { error } = await ctx.admin
    .from("crm_leads")
    .update({ owner_user_id: userId, assigned_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", lead.id)
    .eq("organization_id", ctx.organizationId);
  if (error) return { type: "assign_owner", status: "failed", error: error.message };
  return {
    type: "assign_owner",
    status: "success",
    detail: { user_id: userId, conversation_id: conversationId, automation_stopped: Boolean(conversationId) },
  };
}

registerAction({ type: "assign_owner", execute });
