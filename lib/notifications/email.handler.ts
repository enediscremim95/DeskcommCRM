import type { SupabaseClient } from "@supabase/supabase-js";

import { marcaDaSaida } from "@/lib/branding/saida";
import { buildLeadAlertEmail, type LeadAlertKind } from "@/lib/email/templates/lead-alert";
import { isEmailConfigured, sendEmail } from "@/lib/email/resend";
import { env } from "@/lib/env";
import type { EventHandler, EventRow, HandlerResult } from "@/lib/event-log/dispatcher";
import { createAdminClient } from "@/lib/supabase/admin";

const CONSUMER_KEY = "notification.email.lead-alert.v1";
const NEW_LEAD_MAX_AGE_MS = 30 * 60 * 1000;

interface PreferenceRow {
  user_id: string;
  new_lead: boolean;
  urgent_lead: boolean;
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
    .eq("role", "admin")
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
    .select("user_id,new_lead,urgent_lead" as never)
    .eq("organization_id" as never, organizationId)
    .in("user_id" as never, userIds);
  if (error) throw error;
  const byUser = new Map(
    ((data ?? []) as unknown as PreferenceRow[]).map((row) => [row.user_id, row]),
  );
  return userIds.filter((userId) => {
    const pref = byUser.get(userId);
    // Ausência de linha é o padrão ligado. O opt-out precisa ser explícito.
    return kind === "new_lead" ? pref?.new_lead !== false : pref?.urgent_lead !== false;
  });
}

export async function handleLeadEmailEvent(
  row: EventRow,
  admin: SupabaseClient = createAdminClient(),
): Promise<HandlerResult> {
  const kind = kindFor(row);
  if (!kind)
    return { consumer_key: CONSUMER_KEY, status: "skipped", detail: "evento fora do recorte" };
  if (!row.entity_id)
    return { consumer_key: CONSUMER_KEY, status: "skipped", detail: "lead ausente" };
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
    .select("id,owner_user_id,status")
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

  const marca = await marcaDaSaida(row.organization_id);
  const href = new URL(`/app/leads/${row.entity_id}`, env.NEXT_PUBLIC_APP_URL).toString();
  const urgentReason = row.payload.reason === "task_overdue" ? "task_overdue" : "risk";
  const message = buildLeadAlertEmail({ kind, href, marca, urgentReason });
  let sent = 0;
  let failed = false;

  for (const userId of recipients) {
    const { data, error } = await admin.auth.admin.getUserById(userId);
    const email = data.user?.email?.trim();
    if (error || !email) {
      failed = true;
      continue;
    }
    const result = await sendEmail({
      to: email,
      subject: message.subject,
      html: message.html,
      text: message.text,
      fromName: marca.nome,
      idempotencyKey: `${row.id}:${userId}`,
    });
    if (result.ok) sent += 1;
    else failed = true;
  }

  if (failed) {
    return {
      consumer_key: CONSUMER_KEY,
      status: "error",
      detail: `envio incompleto; confirmados=${sent}; esperados=${recipients.length}`,
    };
  }
  return { consumer_key: CONSUMER_KEY, status: "ok" };
}

export const leadEmailNotificationHandler: EventHandler = {
  key: CONSUMER_KEY,
  events: ["lead.created", "lead.action_required"],
  handle: handleLeadEmailEvent,
};
