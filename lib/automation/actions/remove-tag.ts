/**
 * Ação `remove_tag` — subtração idempotente de tags no LEAD do contexto (ou
 * no CONTATO, se o contexto não tiver lead). Emite lead.tag_removed ou
 * contact.tag_removed com metadata.caused_by_rule, preservando o anti-loop.
 */
import { originFromAutomationEvent } from "@/lib/atendimento/origem-automacao";
import { registerAction } from "@/lib/automation/actions";
import type { ActionCtx, ActionResultDetail } from "@/lib/automation/types";

async function execute(ctx: ActionCtx, config: Record<string, unknown>): Promise<ActionResultDetail> {
  const tags = Array.isArray(config.tags) ? config.tags.map(String) : [];
  if (!tags.length) return { type: "remove_tag", status: "skipped", detail: { reason: "no_tags" } };

  const lead = ctx.context.lead as { id: string; contact_id?: string; tags?: string[] } | undefined;
  const contact = ctx.context.contact as { id: string; tags?: string[] } | undefined;
  const target = lead
    ? { table: "crm_leads", row: lead, event: "lead.tag_removed", kind: "crm_lead" }
    : contact
      ? { table: "contacts", row: contact, event: "contact.tag_removed", kind: "contact" }
      : null;
  if (!target) return { type: "remove_tag", status: "skipped", detail: { reason: "no_target" } };

  const prev = target.row.tags ?? [];
  const removed = [...new Set(tags.filter((tag) => prev.includes(tag)))];
  if (!removed.length) return { type: "remove_tag", status: "success", detail: { removed: [] } };

  const contactId = lead?.contact_id ?? contact?.id;
  const serviceOrigin = contactId
    ? await originFromAutomationEvent(ctx, contactId)
    : null;
  const remaining = prev.filter((tag) => !removed.includes(tag));
  const { error } = await ctx.admin
    .from(target.table)
    .update({ tags: remaining, updated_at: new Date().toISOString() })
    .eq("id", target.row.id)
    .eq("organization_id", ctx.organizationId);
  if (error) return { type: "remove_tag", status: "failed", error: error.message };

  // O mesmo contexto alimenta a próxima ação da regra. Atualizá-lo depois
  // da escrita evita que add_tag reconstrua a lista a partir do estado antigo.
  target.row.tags = remaining;

  await ctx.admin.rpc("emit_event", {
    p_event_type: target.event,
    p_entity_kind: target.kind,
    p_entity_id: target.row.id,
    p_payload: { removed_tags: removed, tags: remaining, service_origin: serviceOrigin },
    p_metadata: { caused_by_rule: ctx.ruleId },
    p_organization_id: ctx.organizationId,
  });
  return { type: "remove_tag", status: "success", detail: { removed } };
}

registerAction({ type: "remove_tag", execute });
