import type { SupabaseClient } from "@supabase/supabase-js";

import { marcaDaSaida } from "@/lib/branding/saida";
import {
  buildLeadAlertEmail,
  buildLeadBatchEmail,
  buildUrgentLeadBatchEmail,
  type LeadAlertKind,
} from "@/lib/email/templates/lead-alert";
import { isEmailConfigured, sendEmail } from "@/lib/email/resend";
import { env } from "@/lib/env";
import type { EventHandler, EventRow, HandlerResult } from "@/lib/event-log/dispatcher";
import { audit } from "@/lib/audit";
import { createAdminClient } from "@/lib/supabase/admin";

const CONSUMER_KEY = "notification.email.lead-alert.v2";
const NEW_LEAD_MAX_AGE_MS = 30 * 60 * 1000;
export const LEAD_EMAIL_BATCH_WINDOW_SECONDS = 30;
const LEAD_EMAIL_PROCESSING_LEASE_MS = 5 * 60 * 1000;

interface PreferenceRow {
  user_id: string;
  email_enabled: boolean;
  new_lead: boolean;
  urgent_lead: boolean;
}

interface BatchRow {
  id: string;
  recipient_user_id: string;
  kind: LeadAlertKind;
  status: "pending" | "processing" | "sent" | "suppressed";
  due_at: string;
  updated_at: string;
  deferred_count: number;
}

interface BatchItemRow {
  lead_id: string;
  lead_title: string;
  created_at: string;
  urgency_reason: string | null;
  stage_name: string | null;
  action_required_at: string | null;
}

function kindFor(row: EventRow): LeadAlertKind | null {
  if (row.event_type === "lead.created") return "new_lead";
  if (row.event_type === "lead.action_required") return "urgent_lead";
  return null;
}

function isStaleNewLead(row: EventRow, now = Date.now()): boolean {
  if (row.event_type !== "lead.created" || !row.created_at) return false;
  const createdAt = Date.parse(row.created_at);
  return Number.isFinite(createdAt) && now - createdAt > NEW_LEAD_MAX_AGE_MS;
}

async function recipientUserIds(
  admin: SupabaseClient,
  organizationId: string,
  ownerUserId: string | null,
): Promise<string[]> {
  if (ownerUserId) {
    const { data, error } = await admin
      .from("user_organizations")
      .select("user_id")
      .eq("organization_id", organizationId)
      .eq("user_id", ownerUserId)
      .is("revoked_at", null)
      .maybeSingle();
    if (error) throw error;
    if (data?.user_id) return [data.user_id];
  }

  const { data, error } = await admin
    .from("user_organizations")
    .select("user_id")
    .eq("organization_id", organizationId)
    .in("role", ["admin", "manager"])
    .is("revoked_at", null);
  if (error) throw error;
  return [...new Set((data ?? []).map((row) => row.user_id))];
}

async function enabledRecipients(
  admin: SupabaseClient,
  organizationId: string,
  userIds: string[],
  kind: LeadAlertKind,
): Promise<string[]> {
  if (userIds.length === 0) return [];
  const { data, error } = await admin
    .from("notification_email_preferences" as never)
    .select("user_id,email_enabled,new_lead,urgent_lead" as never)
    .eq("organization_id" as never, organizationId)
    .in("user_id" as never, userIds);
  if (error) throw error;
  const byUser = new Map(
    ((data ?? []) as unknown as PreferenceRow[]).map((row) => [row.user_id, row]),
  );
  const withoutPreference = userIds.filter((userId) => !byUser.has(userId));
  const platformAdmins = new Set<string>();
  if (withoutPreference.length > 0) {
    const { data: platformRows, error: platformError } = await admin
      .from("platform_admins")
      .select("user_id")
      .in("user_id", withoutPreference)
      .is("revoked_at", null);
    if (platformError) throw platformError;
    for (const platformRow of platformRows ?? []) platformAdmins.add(platformRow.user_id);
  }
  return userIds.filter((userId) => {
    const pref = byUser.get(userId);
    // O dono da instalação acompanha somente as organizações que marcou.
    if (!pref && platformAdmins.has(userId)) return false;
    if (pref?.email_enabled === false) return false;
    return kind === "new_lead" ? pref?.new_lead !== false : pref?.urgent_lead !== false;
  });
}

async function emailMasterEnabled(
  admin: SupabaseClient,
  organizationId: string,
  userId: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from("notification_email_preferences" as never)
    .select("email_enabled" as never)
    .eq("organization_id" as never, organizationId)
    .eq("user_id" as never, userId)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as { email_enabled?: boolean } | null)?.email_enabled !== false;
}

async function organizationName(admin: SupabaseClient, organizationId: string): Promise<string> {
  const { data, error } = await admin
    .from("organizations")
    .select("display_name,legal_name")
    .eq("id", organizationId)
    .maybeSingle();
  if (error) throw error;
  return data?.display_name?.trim() || data?.legal_name?.trim() || "sua organização";
}

async function queueLeadEmail(
  admin: SupabaseClient,
  row: EventRow,
  recipients: string[],
): Promise<HandlerResult> {
  let failed = 0;
  for (const userId of recipients) {
    const { error } = await admin.rpc(
      "fn_queue_lead_email_batch" as never,
      {
        p_event_id: row.id,
        p_recipient_user_id: userId,
        p_window_seconds: LEAD_EMAIL_BATCH_WINDOW_SECONDS,
      } as never,
    );
    if (error) failed += 1;
  }
  if (failed) {
    return {
      consumer_key: CONSUMER_KEY,
      status: "error",
      detail: `não foi possível enfileirar ${failed} destinatário(s)`,
    };
  }
  return { consumer_key: CONSUMER_KEY, status: "ok" };
}

function tempoDecorrido(iso: string | null, now = Date.now()): string {
  if (!iso) return "agora";
  const elapsedMinutes = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
  if (!Number.isFinite(elapsedMinutes) || elapsedMinutes < 1) return "agora";
  if (elapsedMinutes < 60) return `há ${elapsedMinutes} min`;
  const hours = Math.floor(elapsedMinutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  return `há ${days} dia${days === 1 ? "" : "s"}`;
}

function motivoUrgente(reason: string | null): string {
  return reason === "task_overdue" ? "tarefa vencida" : "risco no atendimento";
}

async function handleBatchFlush(row: EventRow, admin: SupabaseClient): Promise<HandlerResult> {
  if (!row.entity_id) {
    return { consumer_key: CONSUMER_KEY, status: "skipped", detail: "lote ausente" };
  }
  const batchId = row.entity_id;
  if (!isEmailConfigured()) {
    return { consumer_key: CONSUMER_KEY, status: "skipped", detail: "email não configurado" };
  }

  const readBatch = () =>
    admin
      .from("notification_email_batches" as never)
      .select("id,recipient_user_id,kind,status,due_at,updated_at,deferred_count" as never)
      .eq("organization_id" as never, row.organization_id)
      .eq("id" as never, batchId)
      .maybeSingle();
  let { data, error } = await readBatch();
  if (error) throw error;
  let batch = data as unknown as BatchRow | null;
  if (!batch) {
    return { consumer_key: CONSUMER_KEY, status: "skipped", detail: "lote não encontrado" };
  }
  if (batch.status === "sent" || batch.status === "suppressed") {
    return {
      consumer_key: CONSUMER_KEY,
      status: "skipped",
      detail: batch.status === "sent" ? "lote já enviado" : "lote suprimido pela cota",
    };
  }
  if (
    batch.status === "processing" &&
    Date.parse(batch.updated_at) + LEAD_EMAIL_PROCESSING_LEASE_MS > Date.now()
  ) {
    return {
      consumer_key: CONSUMER_KEY,
      status: "retry",
      retry_at: new Date(
        Date.parse(batch.updated_at) + LEAD_EMAIL_PROCESSING_LEASE_MS,
      ).toISOString(),
      detail: "outro worker está enviando o lote",
    };
  }
  if (batch.status === "pending" && Date.parse(batch.due_at) > Date.now()) {
    return {
      consumer_key: CONSUMER_KEY,
      status: "retry",
      retry_at: batch.due_at,
      detail: "janela de agrupamento ainda aberta",
    };
  }
  if (batch.status === "pending") {
    const claim = await admin
      .from("notification_email_batches" as never)
      .update({ status: "processing" } as never)
      .eq("organization_id" as never, row.organization_id)
      .eq("id" as never, batchId)
      .eq("status" as never, "pending")
      .lte("due_at" as never, new Date().toISOString())
      .select("id,recipient_user_id,kind,status,due_at,updated_at,deferred_count" as never)
      .maybeSingle();
    if (claim.error) throw claim.error;
    batch = claim.data as unknown as BatchRow | null;
    if (!batch) {
      ({ data, error } = await readBatch());
      if (error) throw error;
      batch = data as unknown as BatchRow | null;
      if (!batch || batch.status === "sent" || batch.status === "suppressed") {
        return {
          consumer_key: CONSUMER_KEY,
          status: "skipped",
          detail: batch?.status === "suppressed" ? "lote suprimido pela cota" : "lote já enviado",
        };
      }
      if (batch.status === "pending") {
        return {
          consumer_key: CONSUMER_KEY,
          status: "retry",
          retry_at: batch.due_at,
          detail: "lote adiado por novo lead",
        };
      }
      if (
        batch.status === "processing" &&
        Date.parse(batch.updated_at) + LEAD_EMAIL_PROCESSING_LEASE_MS > Date.now()
      ) {
        return {
          consumer_key: CONSUMER_KEY,
          status: "retry",
          retry_at: new Date(
            Date.parse(batch.updated_at) + LEAD_EMAIL_PROCESSING_LEASE_MS,
          ).toISOString(),
          detail: "outro worker está enviando o lote",
        };
      }
    }
  }

  const { data: rawItems, error: itemsError } = await admin
    .from("notification_email_batch_items" as never)
    .select("lead_id,lead_title,created_at,urgency_reason,stage_name,action_required_at" as never)
    .eq("organization_id" as never, row.organization_id)
    .eq("batch_id" as never, batchId)
    .order("created_at" as never, { ascending: true });
  if (itemsError) throw itemsError;
  const items = (rawItems ?? []) as unknown as BatchItemRow[];
  if (items.length === 0) {
    await admin
      .from("notification_email_batches" as never)
      .update({ status: "sent", sent_at: new Date().toISOString() } as never)
      .eq("organization_id" as never, row.organization_id)
      .eq("id" as never, batchId);
    return { consumer_key: CONSUMER_KEY, status: "skipped", detail: "lote vazio" };
  }

  if (!(await emailMasterEnabled(admin, row.organization_id, batch.recipient_user_id))) {
    const { error: suppressedError } = await admin
      .from("notification_email_batches" as never)
      .update({ status: "suppressed", sent_at: new Date().toISOString() } as never)
      .eq("organization_id" as never, row.organization_id)
      .eq("id" as never, batchId)
      .eq("status" as never, "processing");
    if (suppressedError) throw suppressedError;
    return {
      consumer_key: CONSUMER_KEY,
      status: "skipped",
      detail: "lote suprimido porque o email da pessoa está desligado",
    };
  }

  const { data: userData, error: userError } = await admin.auth.admin.getUserById(
    batch.recipient_user_id,
  );
  const email = userData.user?.email?.trim();
  if (userError || !email) {
    return { consumer_key: CONSUMER_KEY, status: "error", detail: "destinatário sem email" };
  }

  const marca = await marcaDaSaida(row.organization_id);
  const orgName = await organizationName(admin, row.organization_id);
  const message =
    batch.kind === "urgent_lead"
      ? buildUrgentLeadBatchEmail({
          items: items.map((item) => ({
            title: item.lead_title,
            stage: item.stage_name?.trim() || "Etapa não informada",
            reason: motivoUrgente(item.urgency_reason),
            age: tempoDecorrido(item.action_required_at ?? item.created_at),
          })),
          marca,
          organizationName: orgName,
          funnelHref: new URL("/app/kanban", env.NEXT_PUBLIC_APP_URL).toString(),
          deferredCount: batch.deferred_count,
        })
      : (() => {
          const emailItems = items.map((item) => ({
            title: item.lead_title,
            href: new URL(`/app/leads/${item.lead_id}`, env.NEXT_PUBLIC_APP_URL).toString(),
          }));
          const firstItem = emailItems[0]!;
          return emailItems.length === 1
            ? buildLeadAlertEmail({
                kind: "new_lead",
                href: firstItem.href,
                marca,
                organizationName: orgName,
                leadTitle: firstItem.title,
              })
            : buildLeadBatchEmail({ items: emailItems, marca, organizationName: orgName });
        })();
  const result = await sendEmail({
    to: email,
    subject: message.subject,
    html: message.html,
    text: message.text,
    fromName: marca.nome,
    idempotencyKey: `lead-email-batch:${batch.id}:${batch.recipient_user_id}`,
  });
  if (!result.ok) {
    if (result.error === "rate_limited") {
      const suppressedAt = new Date().toISOString();
      const { error: suppressedError } = await admin
        .from("notification_email_batches" as never)
        .update({ status: "suppressed", sent_at: suppressedAt } as never)
        .eq("organization_id" as never, row.organization_id)
        .eq("id" as never, batchId)
        .eq("status" as never, "processing");
      if (suppressedError) throw suppressedError;
      await audit({
        action: "notification.email_quota_exceeded",
        organizationId: row.organization_id,
        resourceType: "notification_email_batch",
        resourceId: batchId,
        bypassedRls: true,
        metadata: { kind: batch.kind, recipient_user_id: batch.recipient_user_id },
      });
      return {
        consumer_key: CONSUMER_KEY,
        status: "ok",
        detail: "lote suprimido após limite do provedor",
      };
    }
    return {
      consumer_key: CONSUMER_KEY,
      status: "error",
      detail: `falha no envio do lote: ${result.error ?? "desconhecida"}`,
    };
  }

  const { error: sentError } = await admin
    .from("notification_email_batches" as never)
    .update({ status: "sent", sent_at: new Date().toISOString() } as never)
    .eq("organization_id" as never, row.organization_id)
    .eq("id" as never, batchId)
    .eq("status" as never, "processing");
  if (sentError) throw sentError;
  return { consumer_key: CONSUMER_KEY, status: "ok" };
}

export async function handleLeadEmailEvent(
  row: EventRow,
  admin: SupabaseClient = createAdminClient(),
): Promise<HandlerResult> {
  if (row.event_type === "notification.email_batch_due") {
    return handleBatchFlush(row, admin);
  }

  const kind = kindFor(row);
  if (!kind) {
    return { consumer_key: CONSUMER_KEY, status: "skipped", detail: "evento fora do recorte" };
  }
  if (!row.entity_id) {
    return { consumer_key: CONSUMER_KEY, status: "skipped", detail: "lead ausente" };
  }
  if (isStaleNewLead(row)) {
    return {
      consumer_key: CONSUMER_KEY,
      status: "skipped",
      detail: "lead antigo não gera aviso retroativo",
    };
  }
  if (!isEmailConfigured()) {
    return { consumer_key: CONSUMER_KEY, status: "skipped", detail: "email não configurado" };
  }

  const { data: lead, error: leadError } = await admin
    .from("crm_leads")
    .select("id,owner_user_id,status,title")
    .eq("organization_id", row.organization_id)
    .eq("id", row.entity_id)
    .maybeSingle();
  if (leadError) throw leadError;
  if (!lead || lead.status !== "open") {
    return { consumer_key: CONSUMER_KEY, status: "skipped", detail: "lead não está aberto" };
  }

  const candidates = await recipientUserIds(admin, row.organization_id, lead.owner_user_id);
  const recipients = await enabledRecipients(admin, row.organization_id, candidates, kind);
  if (recipients.length === 0) {
    return {
      consumer_key: CONSUMER_KEY,
      status: "skipped",
      detail: "sem destinatário com email ligado",
    };
  }
  return queueLeadEmail(admin, row, recipients);
}

export const leadEmailNotificationHandler: EventHandler = {
  key: CONSUMER_KEY,
  events: ["lead.created", "lead.action_required", "notification.email_batch_due"],
  handle: handleLeadEmailEvent,
};
