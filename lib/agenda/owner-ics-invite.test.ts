import { describe, expect, it } from "vitest";
import { buildOwnerIcs } from "./owner-ics-invite.handler";

describe("convite ICS do responsável", () => {
  it("leva horário, fuso, contato e link sem destinatário do lead", () => {
    const ics = buildOwnerIcs({ id: "a", title: "Consulta", startsAt: "2026-11-15T12:00:00Z", endsAt: "2026-11-15T13:00:00Z", timeZone: "America/Sao_Paulo", meetingUrl: "https://meet.jit.si/consulta-0123456789abcdef0123", contactName: "Maria" });
    expect(ics).toContain("DTSTART:20261115T120000Z");
    expect(ics).toContain("X-WR-TIMEZONE:America/Sao_Paulo");
    expect(ics).toContain("Contato: Maria");
    expect(ics).toContain("https://meet.jit.si/consulta-0123456789abcdef0123");
    expect(ics).not.toContain("ATTENDEE");
  });
});
