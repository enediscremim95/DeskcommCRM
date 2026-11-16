import { createAdminClient } from "@/lib/supabase/admin";
import { marcaDaSaida } from "@/lib/branding/saida";
import { isEmailConfigured, sendEmail } from "@/lib/email/resend";
import type { EventHandler } from "@/lib/event-log/dispatcher";
import { jitsiVideoUrl } from "@/lib/agenda/jitsi";
import { rotuloDoContato } from "@/lib/contacts/rotulo-do-contato";

const CONSUMER_KEY = "agenda.owner-ics-invite.v1";

function escapeIcs(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function stamp(value: string): string {
  return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function buildOwnerIcs(args: {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  timeZone: string;
  meetingUrl: string;
  contactName: string;
}): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CRM//Agenda//PT-BR",
    `X-WR-TIMEZONE:${escapeIcs(args.timeZone)}`,
    "BEGIN:VEVENT",
    `UID:${args.id}@agenda.local`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(args.startsAt)}`,
    `DTEND:${stamp(args.endsAt)}`,
    `SUMMARY:${escapeIcs(args.title)}`,
    `DESCRIPTION:${escapeIcs(`Contato: ${args.contactName}\nLink da reunião: ${args.meetingUrl}\nFuso: ${args.timeZone}`)}`,
    `LOCATION:${escapeIcs(args.meetingUrl)}`,
    `URL:${args.meetingUrl}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

export const ownerIcsInviteHandler: EventHandler = {
  key: CONSUMER_KEY,
  events: ["agenda.owner_ics_invite"],
  async handle(row) {
    if (!row.entity_id) return { consumer_key: CONSUMER_KEY, status: "skipped", detail: "compromisso ausente" };
    if (!isEmailConfigured()) return { consumer_key: CONSUMER_KEY, status: "skipped", detail: "email não configurado" };
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("calendar_appointments")
      .select("id,title,starts_at,ends_at,time_zone,status,owner_user_id,meeting_state,meeting_url,contacts(name,display_name,phone_number)")
      .eq("organization_id", row.organization_id)
      .eq("id", row.entity_id)
      .maybeSingle();
    if (error) throw error;
    const meetingUrl = jitsiVideoUrl(data?.meeting_url);
    if (!data || data.status === "cancelled" || data.meeting_state !== "ready" || !meetingUrl) {
      return { consumer_key: CONSUMER_KEY, status: "skipped", detail: "convite não aplicável" };
    }
    const user = await admin.auth.admin.getUserById(data.owner_user_id);
    const email = user.data.user?.email;
    if (user.error || !email) return { consumer_key: CONSUMER_KEY, status: "error", detail: "responsável sem email" };
    const contact = Array.isArray(data.contacts) ? data.contacts[0] : data.contacts;
    const contactName = rotuloDoContato(contact);
    const title = data.title?.trim() || "Agendamento";
    const ics = buildOwnerIcs({ id: data.id, title, startsAt: data.starts_at, endsAt: data.ends_at, timeZone: data.time_zone, meetingUrl, contactName });
    const marca = await marcaDaSaida(row.organization_id);
    const result = await sendEmail({
      to: email,
      subject: `Agendamento: ${title}`,
      html: `<p>O agendamento com ${contactName.replace(/[<>&"]/g, "")} foi criado.</p><p><a href="${meetingUrl}">Abrir reunião</a></p>`,
      text: `O agendamento com ${contactName} foi criado. Link da reunião: ${meetingUrl}`,
      fromName: marca.nome,
      idempotencyKey: `agenda-owner-ics:${data.id}`,
      attachments: [{ filename: `agendamento-${data.id}.ics`, content: ics, contentType: "text/calendar; charset=utf-8; method=PUBLISH" }],
    });
    return result.ok
      ? { consumer_key: CONSUMER_KEY, status: "ok" }
      : { consumer_key: CONSUMER_KEY, status: "error", detail: result.error ?? "falha no envio" };
  },
};
