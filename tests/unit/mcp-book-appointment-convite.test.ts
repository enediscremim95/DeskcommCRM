import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import type * as AgendaConsulta from "@/lib/agenda/consulta";
import { resolverEmailDoConvidado } from "@/lib/agenda/convite-por-email";
import type { McpContext } from "@/lib/mcp/types";
import { criarFakeSupabase } from "@/lib/tarefas/fake-supabase.test-helper";

/**
 * Convite por e-mail no `crm_book_appointment` (migration 0320). Opt-in por
 * tipo: desligado, nada muda — nem com e-mail informado pelo modelo.
 */
vi.mock("@/app/api/v1/agenda/agendamentos/_handler", () => ({
  marcarAgendamentoHandler: vi.fn(),
  alterarAgendamentoHandler: vi.fn(),
  cancelarAgendamentoHandler: vi.fn(),
}));
vi.mock("@/lib/agenda/consulta", async (original) => {
  const real = await original<typeof AgendaConsulta>();
  return { ...real, idDoTipoPorSlug: vi.fn() };
});

const { idDoTipoPorSlug } = await import("@/lib/agenda/consulta");
const { crmBookAppointment } = await import("@/lib/mcp/tools/agendamento");
const handlers = await import("@/app/api/v1/agenda/agendamentos/_handler");

function ctxCom(convite: boolean, emailDoContato: string | null): McpContext {
  const db = criarFakeSupabase({
    calendar_event_types: [
      { id: "tipo-1", organization_id: "org-1", guest_invite_enabled: convite },
      // Mesmo id em outra organização, com convite ligado: não pode vazar.
      { id: "tipo-1", organization_id: "org-2", guest_invite_enabled: true },
    ],
    contacts: [
      { id: "c-1", organization_id: "org-1", email: emailDoContato },
      { id: "c-1", organization_id: "org-2", email: "outra-org@exemplo.com" },
    ],
  });
  return {
    organizationId: "org-1",
    role: "agent",
    actor: { type: "ai_agent", id: "ag-1", role: "ai_operator" },
    apiTokenId: "tok-1",
    requestId: "req-1",
    supabase: db as unknown as SupabaseClient,
  };
}

const pedido = { event_type_slug: "apresentacao", starts_at: "2026-12-01T13:00:00Z", contact_id: "c-1" };

function guestPassado(): unknown {
  return (vi.mocked(handlers.marcarAgendamentoHandler).mock.calls[0]![2] as { guest_email?: string }).guest_email;
}

describe("crm_book_appointment — convidado por e-mail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(idDoTipoPorSlug).mockResolvedValue({ id: "tipo-1", nome: "Apresentação" });
    vi.mocked(handlers.marcarAgendamentoHandler).mockResolvedValue({ id: "a-1", meeting_state: "ready" });
  });

  it("desligado (padrão): não passa convidado, nem com e-mail informado", async () => {
    const r = await crmBookAppointment.handler({ ...pedido, guest_email: "ana@exemplo.com" }, ctxCom(false, "c@exemplo.com"));
    expect(guestPassado()).toBeUndefined();
    expect(r).not.toHaveProperty("convite");
  });

  it("ligado: o e-mail informado vence e vira convidado", async () => {
    const r = await crmBookAppointment.handler({ ...pedido, guest_email: " Ana@Exemplo.com " }, ctxCom(true, "c@exemplo.com"));
    expect(guestPassado()).toBe("ana@exemplo.com");
    expect(r).toMatchObject({ marcado: true, convite: expect.stringContaining("email_registrado_para_convite") });
    // Nada observou o Google enviar: a resposta não pode afirmar envio.
    expect(JSON.stringify(r)).not.toMatch(/convite_enviado|convite foi enviado/);
  });

  it("ligado sem e-mail informado: usa o do contato da MESMA organização", async () => {
    const r = await crmBookAppointment.handler(pedido, ctxCom(true, "contato@exemplo.com"));
    expect(guestPassado()).toBe("contato@exemplo.com");
    expect(r).toMatchObject({ convite: expect.stringContaining("email_registrado_para_convite") });
  });

  it("ligado, e-mail inválido: marca sem convidado e avisa o modelo", async () => {
    const r = await crmBookAppointment.handler({ ...pedido, guest_email: "ana@" }, ctxCom(true, "contato@exemplo.com"));
    expect(guestPassado()).toBeUndefined();
    expect(r).toMatchObject({ marcado: true, convite: expect.stringContaining("email_invalido") });
  });

  it("ligado sem e-mail nenhum: marca do mesmo jeito", async () => {
    const r = await crmBookAppointment.handler(pedido, ctxCom(true, null));
    expect(guestPassado()).toBeUndefined();
    expect(r).toMatchObject({ marcado: true, convite: expect.stringContaining("sem_email") });
  });

  it("falha ao ler a opção não derruba a marcação", async () => {
    const ctx = { ...ctxCom(true, null), supabase: {} as unknown as SupabaseClient };
    const r = await crmBookAppointment.handler(pedido, ctx);
    expect(r).toMatchObject({ marcado: true });
    expect(guestPassado()).toBeUndefined();
  });
});

describe("resolverEmailDoConvidado", () => {
  it("regra pura", () => {
    expect(resolverEmailDoConvidado({ ligado: false, informado: "a@b.com" })).toEqual({ email: null, origem: "desligado" });
    expect(resolverEmailDoConvidado({ ligado: true, informado: "", doContato: "x@y.com" })).toEqual({ email: "x@y.com", origem: "contato" });
    expect(resolverEmailDoConvidado({ ligado: true, doContato: "lixo" })).toEqual({ email: null, origem: "sem_email" });
  });
});
