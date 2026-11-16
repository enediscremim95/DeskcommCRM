import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventRow } from "@/lib/event-log/dispatcher";

const mocks = vi.hoisted(() => ({
  configured: vi.fn(() => true),
  send: vi.fn(async (_args: Record<string, unknown>) => ({ ok: true })),
  from: vi.fn(),
  eq: vi.fn(),
  single: vi.fn(),
  user: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: mocks.from,
    auth: { admin: { getUserById: mocks.user } },
  }),
}));
vi.mock("@/lib/branding/saida", () => ({ marcaDaSaida: async () => ({ nome: "CRM" }) }));
vi.mock("@/lib/email/resend", () => ({
  isEmailConfigured: mocks.configured,
  sendEmail: mocks.send,
}));
import { ownerIcsInviteHandler } from "./owner-ics-invite.handler";

const event: EventRow = {
  id: "event",
  organization_id: "org-one",
  entity_id: "appointment",
  event_type: "agenda.owner_ics_invite",
  entity_kind: "calendar_appointment",
  payload: {},
  metadata: {},
  consumed_by: [],
  attempts: 0,
};
const appointment = () => ({
  id: "appointment",
  title: "Consulta",
  starts_at: "2026-11-15T12:00:00Z",
  ends_at: "2026-11-15T13:00:00Z",
  time_zone: "America/Sao_Paulo",
  status: "confirmed",
  owner_user_id: "owner",
  meeting_state: "ready",
  meeting_url: "https://meet.jit.si/consulta-0123456789abcdef0123",
  guest_email: null as string | null,
  contacts: { name: "Maria", display_name: "Maria", email: "client@example.invalid" },
});
let data = appointment();
beforeEach(() => {
  vi.clearAllMocks();
  data = appointment();
  mocks.configured.mockReturnValue(true);
  mocks.send.mockResolvedValue({ ok: true });
  mocks.user.mockResolvedValue({ data: { user: { email: "owner@example.invalid" } }, error: null });
  const query = { select: () => query, eq: mocks.eq, maybeSingle: mocks.single };
  mocks.eq.mockReturnValue(query);
  mocks.from.mockReturnValue(query);
  mocks.single.mockImplementation(async () => ({ data, error: null }));
});

describe("convite ICS ao cliente — transporte inteiramente mockado", () => {
  it("envia anexos separados ao cliente e responsável e filtra as duas tabelas pela organização", async () => {
    expect((await ownerIcsInviteHandler.handle(event)).status).toBe("ok");
    expect(mocks.eq).toHaveBeenCalledWith("organization_id", event.organization_id);
    expect(mocks.eq).toHaveBeenCalledWith("contacts.organization_id", event.organization_id);
    expect(mocks.eq).toHaveBeenCalledWith("id", event.entity_id);
    expect(mocks.send.mock.calls.map(([args]) => args.to)).toEqual([
      "owner@example.invalid",
      "client@example.invalid",
    ]);
    for (const [args] of mocks.send.mock.calls) {
      expect(args.attachments).toEqual([
        expect.objectContaining({
          filename: "agendamento-appointment.ics",
          content: expect.stringContaining("DTSTART:20261115T120000Z"),
        }),
      ]);
      expect(args.text).toContain(data.meeting_url);
    }
    expect(mocks.send.mock.calls[0]?.[0].idempotencyKey).not.toEqual(
      mocks.send.mock.calls[1]?.[0].idempotencyKey,
    );
  });
  it("prefere convidado explícito ao contato", async () => {
    data.guest_email = "guest@example.invalid";
    await ownerIcsInviteHandler.handle(event);
    expect(mocks.send.mock.calls.map(([args]) => args.to)).toEqual([
      "owner@example.invalid",
      "guest@example.invalid",
    ]);
  });
  it("não perde o convite do cliente se responsável não tem email", async () => {
    mocks.user.mockResolvedValue({ data: { user: null }, error: { message: "not found" } });
    expect((await ownerIcsInviteHandler.handle(event)).status).toBe("ok");
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ to: "client@example.invalid" }),
    );
  });
  it("indisponibilidade do Auth não impede o convite do cliente", async () => {
    mocks.user.mockRejectedValue(new Error("Auth indisponível"));
    expect((await ownerIcsInviteHandler.handle(event)).status).toBe("ok");
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ to: "client@example.invalid" }),
    );
  });
  it("sem email do cliente preserva a entrega ao responsável", async () => {
    data.contacts.email = "";
    expect((await ownerIcsInviteHandler.handle(event)).status).toBe("ok");
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ to: "owner@example.invalid" }),
    );
  });
  it("sem nenhum destinatário válido encerra sem tentar envio", async () => {
    data.contacts.email = "inválido";
    mocks.user.mockResolvedValue({ data: { user: null }, error: null });
    expect((await ownerIcsInviteHandler.handle(event)).status).toBe("skipped");
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("repete falha parcial com a mesma chave por destinatário", async () => {
    mocks.send.mockResolvedValueOnce({ ok: false });
    expect((await ownerIcsInviteHandler.handle(event)).status).toBe("error");
    const firstKeys = mocks.send.mock.calls.map(([args]) => args.idempotencyKey);
    expect((await ownerIcsInviteHandler.handle(event)).status).toBe("ok");
    expect(mocks.send.mock.calls.slice(2).map(([args]) => args.idempotencyKey)).toEqual(firstKeys);
  });
  it("exceção no transporte do responsável não bloqueia cliente", async () => {
    mocks.send.mockRejectedValueOnce(new Error("timeout"));
    expect((await ownerIcsInviteHandler.handle(event)).status).toBe("error");
    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(mocks.send.mock.calls[1]?.[0].to).toBe("client@example.invalid");
  });
  it("ignora compromisso cancelado", async () => {
    data.status = "cancelled";
    expect((await ownerIcsInviteHandler.handle(event)).status).toBe("skipped");
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("não envia se a busca com escopo não encontra compromisso", async () => {
    mocks.single.mockResolvedValue({ data: null, error: null });
    expect((await ownerIcsInviteHandler.handle(event)).status).toBe("skipped");
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("sem transporte configurado não tenta envio", async () => {
    mocks.configured.mockReturnValue(false);
    expect((await ownerIcsInviteHandler.handle(event)).status).toBe("skipped");
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
