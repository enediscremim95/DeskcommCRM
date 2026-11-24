import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { criarFakeSupabase } from "@/lib/tarefas/fake-supabase.test-helper";

import { decidirEscalonamento, escalonarLembretesSemResposta } from "./escalonamento-do-lembrete";

const agora = new Date("2026-12-03T16:25:00Z");
const enviado = "2026-12-03T16:00:00.000Z"; // 25 min atrás
const comeca = "2026-12-03T17:00:00.000Z";

describe("decidirEscalonamento", () => {
  const base = {
    agora,
    lembreteEnviadoEm: new Date(enviado),
    esperaMin: 20,
    comecaEm: new Date(comeca),
    status: "confirmed",
    respondeuDepois: false,
  };
  it("sem resposta depois da espera: escala", () => expect(decidirEscalonamento(base)).toBe("escalated"));
  it("respondeu depois do lembrete: confirmou", () =>
    expect(decidirEscalonamento({ ...base, respondeuDepois: true })).toBe("confirmed"));
  it("antes da espera: aguarda", () => expect(decidirEscalonamento({ ...base, esperaMin: 30 })).toBe("aguardar"));
  it("reunião já começou: não se aplica", () =>
    expect(decidirEscalonamento({ ...base, comecaEm: new Date("2026-12-03T16:20:00Z") })).toBe("not_applicable"));
  it("compromisso cancelado: não se aplica", () =>
    expect(decidirEscalonamento({ ...base, status: "cancelled" })).toBe("not_applicable"));
});

function compromisso(over: Record<string, unknown> = {}) {
  return {
    id: "ap-1",
    organization_id: "org-A",
    contact_id: "c-1",
    conversation_id: "conv-1",
    title: "Apresentação",
    status: "confirmed",
    starts_at: comeca,
    reminder_sent_at: enviado,
    reminder_escalation_checked_at: null,
    calendar_event_types: { reminder_escalation_enabled: true, reminder_escalation_minutes: 20 },
    ...over,
  };
}

function montar(apts: Record<string, unknown>[], mensagens: Record<string, unknown>[] = []) {
  const db = criarFakeSupabase({
    calendar_appointments: apts,
    messages: mensagens,
    contacts: [{ id: "c-1", organization_id: "org-A", name: "Ana", display_name: null }],
  });
  const criarTarefa = vi.fn().mockResolvedValue({
    taskId: "t-1", criada: true, avisoAberto: true, assignedTo: "sdr", origem: "responsavel_do_numero",
    leadId: "lead-1", conversationId: "conv-1",
  });
  const handoff = vi.fn().mockResolvedValue({ triggered: true, reason: "ok" });
  const gemeos = vi.fn(async (_a: SupabaseClient, _o: string, c: string) => [c]);
  return { db, criarTarefa, handoff, gemeos };
}

describe("escalonarLembretesSemResposta", () => {
  it("sem resposta: tarefa + handoff oficial + carimbo, uma vez só", async () => {
    const m = montar([compromisso()]);
    const deps = { criarTarefa: m.criarTarefa, handoff: m.handoff, gemeos: m.gemeos };
    const r = await escalonarLembretesSemResposta(m.db as unknown as SupabaseClient, agora, deps);
    expect(r).toMatchObject({ escalados: 1, confirmados: 0 });
    expect(m.criarTarefa).toHaveBeenCalledWith(
      m.db,
      expect.objectContaining({
        organizationId: "org-A",
        sourceKey: "agenda:ap-1:lembrete_sem_confirmacao",
        title: expect.stringContaining("Ligar para Ana"),
        contactId: "c-1",
        conversationId: "conv-1",
      }),
    );
    expect(m.handoff).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "conv-1", organizationId: "org-A", reason: "lembrete_sem_confirmacao", leadId: "lead-1" }),
    );
    expect(m.db.tabelas.calendar_appointments![0]).toMatchObject({ reminder_escalation_result: "escalated" });

    // Segunda rodada: já carimbado, nada se repete.
    const r2 = await escalonarLembretesSemResposta(m.db as unknown as SupabaseClient, agora, deps);
    expect(r2.examinados).toBe(0);
    expect(m.criarTarefa).toHaveBeenCalledTimes(1);
    expect(m.handoff).toHaveBeenCalledTimes(1);
  });

  it("mensagem do cliente depois do lembrete = confirmou: nada de tarefa nem handoff", async () => {
    const m = montar([compromisso()], [
      { id: "msg-1", organization_id: "org-A", contact_id: "c-1", direction: "inbound", sent_at: "2026-12-03T16:05:00.000Z" },
    ]);
    const r = await escalonarLembretesSemResposta(m.db as unknown as SupabaseClient, agora, m);
    expect(r).toMatchObject({ confirmados: 1, escalados: 0 });
    expect(m.criarTarefa).not.toHaveBeenCalled();
    expect(m.handoff).not.toHaveBeenCalled();
    expect(m.db.tabelas.calendar_appointments![0]).toMatchObject({ reminder_escalation_result: "confirmed" });
  });

  it("mensagem ANTES do lembrete, ou de outra organização, não conta como confirmação", async () => {
    const m = montar([compromisso()], [
      { id: "m-antes", organization_id: "org-A", contact_id: "c-1", direction: "inbound", sent_at: "2026-12-03T15:00:00.000Z" },
      { id: "m-outra", organization_id: "org-B", contact_id: "c-1", direction: "inbound", sent_at: "2026-12-03T16:10:00.000Z" },
      { id: "m-saida", organization_id: "org-A", contact_id: "c-1", direction: "outbound", sent_at: "2026-12-03T16:10:00.000Z" },
    ]);
    const r = await escalonarLembretesSemResposta(m.db as unknown as SupabaseClient, agora, m);
    expect(r.escalados).toBe(1);
  });

  it("desligado no tipo (padrão): o compromisso nem é examinado", async () => {
    const m = montar([compromisso({ calendar_event_types: { reminder_escalation_enabled: false, reminder_escalation_minutes: 20 } })]);
    const r = await escalonarLembretesSemResposta(m.db as unknown as SupabaseClient, agora, m);
    expect(r.examinados).toBe(0);
    expect(m.criarTarefa).not.toHaveBeenCalled();
    expect(m.db.tabelas.calendar_appointments![0]).toMatchObject({ reminder_escalation_checked_at: null });
  });

  it("dentro da espera: aguarda sem carimbar", async () => {
    const m = montar([compromisso({ calendar_event_types: { reminder_escalation_enabled: true, reminder_escalation_minutes: 40 } })]);
    const r = await escalonarLembretesSemResposta(m.db as unknown as SupabaseClient, agora, m);
    expect(r).toMatchObject({ aguardando: 1, escalados: 0 });
    expect(m.db.tabelas.calendar_appointments![0]).toMatchObject({ reminder_escalation_checked_at: null });
  });

  it("falha ao criar a tarefa não carimba: a próxima rodada tenta de novo", async () => {
    const m = montar([compromisso()]);
    m.criarTarefa.mockRejectedValueOnce(new Error("db fora"));
    const r = await escalonarLembretesSemResposta(m.db as unknown as SupabaseClient, agora, m);
    expect(r).toMatchObject({ erros: 1, escalados: 0 });
    expect(m.db.tabelas.calendar_appointments![0]).toMatchObject({ reminder_escalation_checked_at: null });
    const r2 = await escalonarLembretesSemResposta(m.db as unknown as SupabaseClient, agora, m);
    expect(r2.escalados).toBe(1);
  });
});
