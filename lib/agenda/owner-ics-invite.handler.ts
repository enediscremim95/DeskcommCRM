import { createHash } from "node:crypto";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { marcaDaSaida } from "@/lib/branding/saida";
import { isEmailConfigured, sendEmail } from "@/lib/email/resend";
import type { EventHandler } from "@/lib/event-log/dispatcher";
import { jitsiVideoUrl } from "@/lib/agenda/jitsi";
import { rotuloDoContato } from "@/lib/contacts/rotulo-do-contato";

const CONSUMER_KEY = "agenda.owner-ics-invite.v1";

function escapeIcs(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

/** RFC 5545: 75 octetos por linha física, sem cortar um caractere UTF-8. */
function foldIcsLine(value: string): string {
  const lines: string[] = [];
  let line = "";
  let octets = 0;
  for (const character of value) {
    const size = Buffer.byteLength(character, "utf8");
    if (octets + size > 75) {
      lines.push(line);
      line = " ";
      octets = 1;
    }
    line += character;
    octets += size;
  }
  lines.push(line);
  return lines.join("\r\n");
}

function stamp(value: string): string {
  return new Date(value)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
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
    "METHOD:PUBLISH",
    "PRODID:-//CRM//Agenda//PT-BR",
    `X-WR-TIMEZONE:${escapeIcs(args.timeZone)}`,
    "BEGIN:VEVENT",
    `UID:${escapeIcs(args.id)}@agenda.local`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(args.startsAt)}`,
    `DTEND:${stamp(args.endsAt)}`,
    `SUMMARY:${escapeIcs(args.title)}`,
    `DESCRIPTION:${escapeIcs(`Contato: ${args.contactName}\nLink da reunião: ${args.meetingUrl}\nFuso: ${args.timeZone}`)}`,
    `LOCATION:${escapeIcs(args.meetingUrl)}`,
    `URL:${escapeIcs(args.meetingUrl)}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ]
    .map(foldIcsLine)
    .join("\r\n");
}

export const ownerIcsInviteHandler: EventHandler = {
  key: CONSUMER_KEY,
  events: ["agenda.owner_ics_invite"],
  async handle(row) {
    if (!row.entity_id)
      return { consumer_key: CONSUMER_KEY, status: "skipped", detail: "compromisso ausente" };
    if (!isEmailConfigured())
      return { consumer_key: CONSUMER_KEY, status: "skipped", detail: "email não configurado" };
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("calendar_appointments")
      .select(
        "id,title,starts_at,ends_at,time_zone,status,owner_user_id,guest_email,meeting_state,meeting_url,contacts(name,display_name,email,phone_number)",
      )
      .eq("organization_id", row.organization_id)
      .eq("id", row.entity_id)
      .eq("contacts.organization_id", row.organization_id)
      .maybeSingle();
    if (error) throw error;
    const meetingUrl = jitsiVideoUrl(data?.meeting_url);
    if (!data || data.status === "cancelled" || data.meeting_state !== "ready" || !meetingUrl) {
      return { consumer_key: CONSUMER_KEY, status: "skipped", detail: "convite não aplicável" };
    }
    let ownerEmail: string | undefined;
    try {
      const user = await admin.auth.admin.getUserById(data.owner_user_id);
      if (!user.error) ownerEmail = user.data.user?.email;
    } catch {
      // A indisponibilidade do Auth não pode impedir o convite do cliente.
    }
    const contact = Array.isArray(data.contacts) ? data.contacts[0] : data.contacts;
    const contactName = rotuloDoContato(contact ?? {});
    const title = data.title?.trim() || "Agendamento";
    const ics = buildOwnerIcs({
      id: data.id,
      title,
      startsAt: data.starts_at,
      endsAt: data.ends_at,
      timeZone: data.time_zone,
      meetingUrl,
      contactName,
    });
    const marca = await marcaDaSaida(row.organization_id);
    // Um envio por pessoa: o convite não expõe o e-mail do responsável ao cliente.
    // O convidado explícito prevalece sobre o e-mail do contato atendido.
    const clientEmail = data.guest_email?.trim() || contact?.email?.trim();
    const recipients = [
      { role: "owner", email: ownerEmail },
      { role: "client", email: clientEmail },
    ].filter(
      (recipient): recipient is { role: string; email: string } =>
        z.email().safeParse(recipient.email).success,
    );
    if (!recipients.length) {
      return {
        consumer_key: CONSUMER_KEY,
        status: "skipped",
        detail: "nenhum destinatário com email",
      };
    }
    let failed = false;
    for (const recipient of recipients) {
      const recipientHash = createHash("sha256")
        .update(recipient.email.toLowerCase())
        .digest("hex");
      try {
        const result = await sendEmail({
          to: recipient.email,
          subject: `Agendamento: ${title}`,
          html: `<p>O agendamento com ${contactName.replace(/[<>&"]/g, "")} foi criado.</p><p><a href="${meetingUrl}">Abrir reunião</a></p>`,
          text: `O agendamento com ${contactName} foi criado. Link da reunião: ${meetingUrl}`,
          fromName: marca.nome,
          idempotencyKey: `agenda-${recipient.role}-ics:${data.id}:${recipientHash}`,
          attachments: [
            {
              filename: `agendamento-${data.id}.ics`,
              content: ics,
              contentType: "text/calendar; charset=utf-8; method=PUBLISH",
            },
          ],
        });
        if (!result.ok) failed = true;
      } catch {
        // A falha de um destinatário não impede a tentativa do outro. O drain
        // repete o evento; a chave por pessoa mantém os envios idempotentes.
        failed = true;
      }
    }
    return failed
      ? { consumer_key: CONSUMER_KEY, status: "error", detail: "falha no envio do convite" }
      : { consumer_key: CONSUMER_KEY, status: "ok" };
  },
};
