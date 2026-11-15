import type { SupabaseClient } from "@supabase/supabase-js";
import { gerarJitsiVideoUrl } from "@/lib/agenda/jitsi";
import { classificarErroDoGoogle, estadoDaConexaoApos, type OperacaoNoGoogle } from "./erros";

export const GOOGLE_EXPIRED_MESSAGE =
  "A conexão com o Google expirou. Reconecte a agenda.";

export async function googleDestinationUsable(
  db: SupabaseClient,
  organizationId: string,
  ownerUserId: string,
): Promise<boolean> {
  const connection = await db
    .from("calendar_connections")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("user_id", ownerUserId)
    .eq("status", "healthy")
    .maybeSingle();
  if (connection.error || !connection.data) return false;

  const destination = await db
    .from("calendar_connection_calendars")
    .select("id,access_role")
    .eq("organization_id", organizationId)
    .eq("connection_id", connection.data.id)
    .eq("is_destination", true)
    .eq("available", true)
    .maybeSingle();
  return !destination.error && ["owner", "writer"].includes(destination.data?.access_role ?? "");
}

export async function fallbackAppointmentToJitsi(
  db: SupabaseClient,
  organizationId: string,
  appointmentId: string,
  title: string,
): Promise<void> {
  await db.rpc("fn_appointment_fallback_jitsi", {
    p_org: organizationId,
    p_id: appointmentId,
    p_url: gerarJitsiVideoUrl(title),
  });
}

export async function recordGoogleConnectionFailure(
  db: SupabaseClient,
  args: {
    organizationId: string;
    connectionId: string;
    error: unknown;
    operation: OperacaoNoGoogle;
  },
): Promise<void> {
  const classified = classificarErroDoGoogle(args.error, args.operation);
  const status = estadoDaConexaoApos(classified.desfecho);
  if (!status) return;
  const message = status === "token_expired" ? GOOGLE_EXPIRED_MESSAGE : classified.mensagem;
  const updated = await db
    .from("calendar_connections")
    .update({ status, last_sync_error: message })
    .eq("organization_id", args.organizationId)
    .eq("id", args.connectionId);
  if (updated.error || status !== "token_expired") return;

  await openGoogleExpiredNotice(db, args.organizationId, args.connectionId);
}

export async function openGoogleExpiredNotice(
  db: SupabaseClient,
  organizationId: string,
  connectionId: string,
): Promise<void> {
  await db.from("agent_inbox_items").insert({
    organization_id: organizationId,
    kind: "other",
    severity: "critical",
    title: "Reconecte a agenda do Google",
    body: GOOGLE_EXPIRED_MESSAGE,
    ref_kind: "calendar_connection",
    ref_id: connectionId,
  });
}
