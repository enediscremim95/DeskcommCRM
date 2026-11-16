import { ORIGENS_DE_RESPOSTA_HUMANA } from "@/lib/messaging/resposta-humana";
import type { EventHandler } from "@/lib/event-log/dispatcher";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildContext } from "@/lib/automation/engine";
import { getAction } from "@/lib/automation/actions";
import "@/lib/automation/actions/register-all";
import { idDaBolhaFilaPrimeiraMensagem } from "@/lib/automation/fila-primeira-mensagem";
import type { ActionCtx } from "@/lib/automation/types";
import { capturePolicy, captureBusinessHours, ATTENTION_CONTACT_TAG } from "./capture-policy";
import { captureTick, type CaptureProgress } from "./capture-machine";
import { phoneLookupVariants } from "@/lib/channels/phone-variants";
import { sendOrganizationOutreach } from "@/lib/email/organization-outreach";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
const KEY = "capture-proactivity-v1";
export const captureProactivityHandler: EventHandler = {
 key: KEY, events: ["lead.created"],
 async handle(row) {
  const db = createAdminClient();
  const org = await db.from("organizations").select("settings").eq("id", row.organization_id).maybeSingle();
  if (org.error) throw new Error("capture_policy_read_failed");
  const policy = capturePolicy(org.data?.settings);
  if (!policy.enabled) return { consumer_key: KEY, status: "skipped", detail: "disabled" };
  const now = new Date();
  const expired = !row.created_at || !Number.isFinite(Date.parse(row.created_at)) || now.getTime()-Date.parse(row.created_at) >= 72*3600_000;
  const context = await buildContext(db, row);
  const lead = context.lead as { id: string; source: string; status: string; contact_id: string; tags: string[] } | undefined;
  const contact = context.contact as { id: string; phone_number?: string; email?: string; is_blocked?: boolean; is_anonymized?: boolean; force_human?: boolean; consent?: { marketing?: { declined_at?: string } }; tags?: string[] } | undefined;
  if (!lead || lead.source !== "webhook" || lead.status !== "open" || !contact || contact.is_blocked || contact.is_anonymized || contact.force_human || contact.consent?.marketing?.declined_at || contact.tags?.some((v) => ["nao_contatar", "sem_followup"].includes(v))) return { consumer_key: KEY, status: "skipped", detail: "ineligible" };
  // Qualquer conversa recebida ou resposta humana posterior encerra o primeiro toque.
  const inbound = await db.from("conversations").select("id", { count: "exact", head: true }).eq("organization_id", row.organization_id).eq("contact_id", contact.id).not("last_inbound_at", "is", null);
  if (inbound.error) throw new Error("capture_inbound_read_failed");
  if ((inbound.count ?? 0) > 0) return { consumer_key: KEY, status: "skipped", detail: "already_replied" };
  if (row.created_at) {
   const human = await db.from("messages").select("id", { count: "exact", head: true }).eq("organization_id", row.organization_id).eq("contact_id", contact.id).eq("direction", "outbound").in("sent_via", [...ORIGENS_DE_RESPOSTA_HUMANA]).gte("created_at", row.created_at);
   if (human.error) throw new Error("capture_human_reply_read_failed");
   if ((human.count ?? 0) > 0) return { consumer_key: KEY, status: "skipped", detail: "human_replied" };
   const readyAt = Date.parse(row.created_at)+60_000;
   if (now.getTime() < readyAt) return { consumer_key: KEY, status: "retry", retry_at: new Date(readyAt).toISOString(), detail: "initial_delay" };
  }
  if (!captureBusinessHours(policy, now)) return { consumer_key: KEY, status: "retry", retry_at: new Date(now.getTime()+15*60_000).toISOString(), detail: "outside_business_hours" };
  const saved = row.metadata.capture_proactivity as CaptureProgress | undefined;
  let state: CaptureProgress = saved && ["whatsapp","corrected","email","attention","done"].includes(saved.step) ? saved : { step: "whatsapp" };
  if (expired) state = { step: "attention" };
  const save = async (progress: CaptureProgress) => {
   const { error } = await db.from("event_log").update({ metadata: { ...row.metadata, capture_proactivity: progress } }).eq("organization_id", row.organization_id).eq("id", row.id);
   if (error) throw new Error("capture_progress_write_failed");
  };
  const done = await captureTick(state, policy.max_whatsapp_attempts, {
   save,
   async log(step, result) {
    const recorded = await emitLeadActivity(db, { organizationId: row.organization_id, leadId: lead.id, contactId: contact.id, type: "note", sourceModule: "capture.proactivity", sourceId: row.id, actor: { type: "webhook_source", id: row.id }, reason: `Primeiro contato: ${step} — ${result}.`, payload: { step, result } });
    if (!recorded.ok) throw new Error("capture_attempt_log_failed");
   },
   async whatsapp(corrected) {
    const messageId = idDaBolhaFilaPrimeiraMensagem(row.id, corrected ? 1 : 0);
    const previous = await db.from("messages").select("status").eq("organization_id", row.organization_id).eq("id", messageId).maybeSingle();
    if (previous.error) throw new Error("capture_message_read_failed");
    if (previous.data) return { result: ["sent","delivered","read"].includes(previous.data.status) ? "sent" : previous.data.status === "failed" ? "failed" : "pending", messageId };
    if (!contact.phone_number) return { result: "failed" };
    // Corrige apenas variantes equivalentes do nono dígito. Dígitos arbitrários
    // não são adivinhados: outro número pode pertencer a outra pessoa.
    const alias = corrected ? phoneLookupVariants(contact.phone_number).find((v) => v !== contact.phone_number) : undefined;
    if (corrected && !alias) return { result: "failed" };
    const action = getAction("send_whatsapp_message")!;
    const ctx: ActionCtx = { admin: db, organizationId: row.organization_id, ruleId: row.id, ruleName: "Primeiro contato do formulário", event: row, context, requestId: `capture:${row.id}`, internalMessageId: messageId, internalPhoneCandidate: alias };
    const config = { channel_session_id: policy.channel_session_id, template: policy.whatsapp_text };
    const stop = await action.interruptRule?.(ctx, config);
    if (stop) return { result: "uncertain" };
    const postpone = await action.postponeUntil?.(ctx, config);
    if (postpone) return { result: "pending", messageId };
    const result = await action.execute(ctx, config);
    return { result: result.status === "success" ? "sent" : result.status === "postponed" ? "pending" : "failed", messageId };
   },
   async email() {
    if (!contact.email) return false;
    return sendOrganizationOutreach({ organizationId: row.organization_id, to: contact.email, subject: policy.email_subject, text: policy.email_text, idempotencyKey: `capture:${row.id}:email` });
   },
   async attention() {
    // Releitura evita apagar tags acrescentadas enquanto a sequência aguardava.
    const fresh = await db.from("crm_leads").select("tags").eq("organization_id", row.organization_id).eq("id", lead.id).maybeSingle();
    if (fresh.error || !fresh.data) throw new Error("capture_lead_read_failed");
    const updated = await db.from("crm_leads").update({ tags: [...new Set([...(fresh.data.tags ?? []),ATTENTION_CONTACT_TAG])] }).eq("organization_id", row.organization_id).eq("id", lead.id);
    if (updated.error) throw new Error("capture_attention_write_failed");
   },
  });
  return done ? { consumer_key: KEY, status: "ok" } : { consumer_key: KEY, status: "retry", retry_at: new Date(now.getTime()+60_000).toISOString(), detail: "next_attempt" };
 },
};
