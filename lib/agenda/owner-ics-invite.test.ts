import { describe, expect, it } from "vitest";
import { buildOwnerIcs } from "./owner-ics-invite.handler";

describe("convite ICS do responsável", () => {
  it("leva horário, fuso, contato e link sem destinatário do lead", () => {
    const ics = buildOwnerIcs({
      id: "a",
      title: "Consulta",
      startsAt: "2026-11-15T12:00:00Z",
      endsAt: "2026-11-15T13:00:00Z",
      timeZone: "America/Sao_Paulo",
      meetingUrl: "https://meet.jit.si/consulta-0123456789abcdef0123",
      contactName: "Maria",
    });
    expect(ics).toContain("DTSTART:20261115T120000Z");
    expect(ics).toContain("X-WR-TIMEZONE:America/Sao_Paulo");
    expect(ics).toContain("Contato: Maria");
    expect(ics).toContain("https://meet.jit.si/consulta-0123456789abcdef0123");
    expect(ics).not.toContain("ATTENDEE");
  });
  it("publica METHOD consistente com o MIME e dobra linhas em até 75 octetos UTF-8", () => {
    const title = "Reunião 🚀 ação 漢字 ".repeat(15);
    const ics = buildOwnerIcs({
      id: "a",
      title,
      startsAt: "2026-11-15T12:00:00Z",
      endsAt: "2026-11-15T13:00:00Z",
      timeZone: "America/Sao_Paulo",
      meetingUrl: "https://meet.jit.si/consulta-0123456789abcdef0123",
      contactName: "João 漢字 🚀".repeat(20),
    });
    expect(ics).toContain("METHOD:PUBLISH\r\n");
    expect(ics).toContain("\r\n ");
    for (const line of ics.split("\r\n")) {
      expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
      expect(line).not.toContain("�");
      expect(Buffer.from(line).toString("utf8")).toBe(line);
    }
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain(`SUMMARY:${title}\r\n`);
  });
  it("escapa CR isolado, LF, CRLF e delimitadores sem injetar propriedades", () => {
    const ics = buildOwnerIcs({
      id: "a\rATTENDEE:intruso",
      title: "Consulta\r\nATTENDEE:intruso;teste,barra\\fim",
      startsAt: "2026-11-15T12:00:00Z",
      endsAt: "2026-11-15T13:00:00Z",
      timeZone: "America/Sao_Paulo\rMETHOD:REQUEST",
      meetingUrl: "https://meet.jit.si/teste",
      contactName: "Maria\nBEGIN:VEVENT",
    }).replace(/\r\n /g, "");
    expect(ics).toContain("SUMMARY:Consulta\\nATTENDEE:intruso\\;teste\\,barra\\\\fim");
    expect(ics).toContain("UID:a\\nATTENDEE:intruso@agenda.local");
    expect(ics).toContain("X-WR-TIMEZONE:America/Sao_Paulo\\nMETHOD:REQUEST");
    const lines = ics.split("\r\n");
    expect(lines.filter((line) => line.startsWith("ATTENDEE:"))).toHaveLength(0);
    expect(lines.filter((line) => line === "BEGIN:VEVENT")).toHaveLength(1);
    expect(lines.filter((line) => line.startsWith("METHOD:"))).toEqual(["METHOD:PUBLISH"]);
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });
});
