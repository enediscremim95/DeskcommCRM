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
    envio: "sent" as string | null,
    ligado: true,
  };
  it("sem resposta depois da espera: escala", () => expect(decidirEscalonamento(base)).toBe("escalated"));
  it("respondeu depois do lembrete: confirmou", () =>
    expect(decidirEscalonamento({ ...base, respondeuDepois: true })).toBe("confirmed"));
  it("antes da espera: aguarda", () => expect(decidirEscalonamento({ ...base, esperaMin: 30 })).toBe("aguardar"));
  it("reunião já começou: não se aplica", () =>
    expect(decidirEscalonamento({ ...base, comecaEm: new Date("2026-12-03T16:20:00Z") })).toBe("not_applicable"));
  it("compromisso cancelado: não se aplica", () =>
    expect(decidirEscalonamento({ ...base, status: "cancelled" })).toBe("not_applicable"));
  it("opção desligada: não se aplica", () => expect(decidirEscalonamento({ ...base, ligado: false })).toBe("not_applicable"));
  it("lembrete que falhou não conta prazo", () => expect(decidirEscalonamento({ ...base, envio: "failed" })).toBe("not_applicable"));
  it("lembrete na fila: espera, mesmo depois do prazo", () =>
    expect(decidirEscalonamento({ ...base, envio: "queued" })).toBe("aguardar"));
  it("lembrete sem mensagem conhecida (anterior à versão): não se aplica", () =>
    expect(decidirEscalonamento({ ...base, envio: null })).toBe("not_applicable"));
});

function compromisso(over: Record<string, unknown> = {}) {
  return {
    id: "ap-1",
    organization_id: "org-A",
    event_type_id: "tipo-1",
    contact_id: "c-1",
    conversation_id: "conv-agendamento",
    title: "Apresentação",
    status: "confirmed",
    starts_at: comeca,
    reminder_sent_at: enviado,
    reminder_message_id: "msg-lembrete",
    reminder_conversation_id: "conv-lembrete",
    reminder_escalation_claimed_at: null,
    reminder_escalation_checked_at: null,
    calendar_event_types: { organization_id: "org-A", reminder_escalation_enabled: true, reminder_escalation_minutes: 20 },
    ...over,
  };
}

function montar(opts: {
  apts?: Record<string, unknown>[];
  mensagens?: Record<string, unknown>[];
  tipos?: Record<string, unknown>[];
} = {}) {
  const db = criarFakeSupabase({
    calendar_appointments: opts.apts ?? [compromisso()],
    calendar_event_types: opts.tipos ?? [
      { id: "tipo-1", organization_id: "org-A", reminder_escalation_enabled: true, reminder_escalation_minutes: 20 },
    ],
    messages: [
      { id: "msg-lembrete", organization_id: "org-A", conversation_id: "conv-lembrete", direction: "outbound", status: "sent", sent_at: enviado },
      ...(opts.mensagens ?? []),
    ],
    contacts: [{ id: "c-1", organization_id: "org-A", name: "Ana", display_name: null }],
  });
  const criarTarefa = vi.fn().mockResolvedValue({
    taskId: "t-1", criada: true, avisoAberto: true, assignedTo: "sdr", origem: "responsavel_do_numero",
    leadId: "lead-1", conversationId: "conv-lembrete",
  });
  const handoff = vi.fn().mockResolvedValue({ triggered: true, reason: "ok" });
  return { db, criarTarefa, handoff, deps: { criarTarefa, handoff } };
}

const rodar = (m: ReturnType<typeof montar>) =>
  escalonarLembretesSemResposta(m.db as unknown as SupabaseClient, agora, m.deps);
const linha = (m: ReturnType<typeof montar>) => m.db.tabelas.calendar_appointments![0]!;

describe("escalonarLembretesSemResposta", () => {
  it("sem resposta: tarefa + handoff NA conversa do lembrete + carimbo, uma vez só", async () => {
    const m = montar();
    expect(await rodar(m)).toMatchObject({ escalados: 1 });
    expect(m.criarTarefa).toHaveBeenCalledWith(
      m.db,
      expect.objectContaining({
        organizationId: "org-A",
        sourceKey: "agenda:ap-1:lembrete_sem_confirmacao",
        title: expect.stringContaining("Ligar para Ana"),
        conversationId: "conv-lembrete",
      }),
    );
    expect(m.handoff).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "conv-lembrete", organizationId: "org-A", reason: "lembrete_sem_confirmacao" }),
    );
    expect(linha(m)).toMatchObject({ reminder_escalation_result: "escalated" });

    await rodar(m);
    expect(m.criarTarefa).toHaveBeenCalledTimes(1);
    expect(m.handoff).toHaveBeenCalledTimes(1);
  });

  it("rodadas CONCORRENTES: a posse atômica deixa só uma agir", async () => {
    const m = montar();
    await Promise.all([rodar(m), rodar(m), rodar(m)]);
    expect(m.criarTarefa).toHaveBeenCalledTimes(1);
    expect(m.handoff).toHaveBeenCalledTimes(1);
  });

  it("resposta NA conversa do lembrete depois do envio = confirmou", async () => {
    const m = montar({
      mensagens: [{ id: "in-1", organization_id: "org-A", conversation_id: "conv-lembrete", direction: "inbound", sent_at: "2026-12-03T16:05:00.000Z" }],
    });
    expect(await rodar(m)).toMatchObject({ confirmados: 1, escalados: 0 });
    expect(m.criarTarefa).not.toHaveBeenCalled();
    expect(linha(m)).toMatchObject({ reminder_escalation_result: "confirmed" });
  });

  it("resposta em OUTRA conversa, antes do envio, ou de outra organização não confirma", async () => {
    const m = montar({
      mensagens: [
        { id: "outra-conv", organization_id: "org-A", conversation_id: "conv-agendamento", direction: "inbound", sent_at: "2026-12-03T16:10:00.000Z" },
        { id: "antes", organization_id: "org-A", conversation_id: "conv-lembrete", direction: "inbound", sent_at: "2026-12-03T15:00:00.000Z" },
        { id: "outra-org", organization_id: "org-B", conversation_id: "conv-lembrete", direction: "inbound", sent_at: "2026-12-03T16:10:00.000Z" },
      ],
    });
    expect((await rodar(m)).escalados).toBe(1);
  });

  it("tipo de OUTRA organização no vínculo: nunca escala", async () => {
    const m = montar({
      apts: [compromisso({ calendar_event_types: { organization_id: "org-B", reminder_escalation_enabled: true, reminder_escalation_minutes: 20 } })],
      tipos: [{ id: "tipo-1", organization_id: "org-B", reminder_escalation_enabled: true, reminder_escalation_minutes: 20 }],
    });
    await rodar(m);
    expect(m.criarTarefa).not.toHaveBeenCalled();
    expect(m.handoff).not.toHaveBeenCalled();
  });

  it("tipo desligado DEPOIS da listagem (releitura na org): carimba not_applicable sem efeito", async () => {
    const m = montar({ tipos: [{ id: "tipo-1", organization_id: "org-A", reminder_escalation_enabled: false, reminder_escalation_minutes: 20 }] });
    expect(await rodar(m)).toMatchObject({ nao_aplicaveis: 1, escalados: 0 });
    expect(m.criarTarefa).not.toHaveBeenCalled();
  });

  it("cancelado entre a listagem e a posse: a releitura impede a escalada", async () => {
    const m = montar();
    // A listagem enxerga 'confirmed'; o cancelamento chega na hora da posse.
    const original = m.db.from.bind(m.db);
    let chamadasDeUpdate = 0;
    (m.db as { from: (t: string) => unknown }).from = (t: string) => {
      const b = original(t) as { update: (p: Record<string, unknown>) => unknown };
      if (t !== "calendar_appointments") return b;
      const update = b.update;
      b.update = (p: Record<string, unknown>) => {
        if ("reminder_escalation_claimed_at" in p && p.reminder_escalation_claimed_at && ++chamadasDeUpdate === 1) {
          linha(m).status = "cancelled";
        }
        return update(p);
      };
      return b;
    };
    expect(await rodar(m)).toMatchObject({ nao_aplicaveis: 1, escalados: 0 });
    expect(m.criarTarefa).not.toHaveBeenCalled();
  });

  it("lembrete que falhou: não escala", async () => {
    const m = montar();
    m.db.tabelas.messages![0]!.status = "failed";
    expect(await rodar(m)).toMatchObject({ nao_aplicaveis: 1, escalados: 0 });
  });

  it("handoff com falha TRANSITÓRIA fica pendente (posse devolvida) e escala na rodada seguinte", async () => {
    const m = montar();
    m.handoff.mockResolvedValueOnce({ triggered: false, reason: "orchestrator_error" });
    expect(await rodar(m)).toMatchObject({ erros: 1, escalados: 0 });
    expect(linha(m)).toMatchObject({ reminder_escalation_checked_at: null, reminder_escalation_claimed_at: null });
    expect(await rodar(m)).toMatchObject({ escalados: 1 });
    expect(m.handoff).toHaveBeenCalledTimes(2);
  });

  it("handoff recusado por estado (já com pessoa) não impede o carimbo", async () => {
    const m = montar();
    m.handoff.mockResolvedValueOnce({ triggered: false, reason: "nao_elegivel:humano" });
    expect(await rodar(m)).toMatchObject({ escalados: 1 });
  });

  it("falha ao criar a tarefa devolve a posse: a próxima rodada tenta", async () => {
    const m = montar();
    m.criarTarefa.mockRejectedValueOnce(new Error("db fora"));
    expect(await rodar(m)).toMatchObject({ erros: 1, escalados: 0 });
    expect(linha(m).reminder_escalation_claimed_at).toBeNull();
    expect((await rodar(m)).escalados).toBe(1);
  });

  it("posse abandonada há mais de 10 min é retomada", async () => {
    const m = montar({ apts: [compromisso({ reminder_escalation_claimed_at: "2026-12-03T16:00:00.000Z" })] });
    expect((await rodar(m)).escalados).toBe(1);
  });

  it("posse recente de outra rodada é respeitada", async () => {
    const m = montar({ apts: [compromisso({ reminder_escalation_claimed_at: "2026-12-03T16:24:00.000Z" })] });
    await rodar(m);
    expect(m.criarTarefa).not.toHaveBeenCalled();
  });

  it("desligado no tipo (padrão): o compromisso nem é examinado", async () => {
    const m = montar({
      apts: [compromisso({ calendar_event_types: { organization_id: "org-A", reminder_escalation_enabled: false, reminder_escalation_minutes: 20 } })],
    });
    expect((await rodar(m)).examinados).toBe(0);
    expect(linha(m)).toMatchObject({ reminder_escalation_checked_at: null, reminder_escalation_claimed_at: null });
  });

  it("dentro da espera: aguarda sem tomar posse", async () => {
    const m = montar({
      apts: [compromisso({ calendar_event_types: { organization_id: "org-A", reminder_escalation_enabled: true, reminder_escalation_minutes: 40 } })],
    });
    expect(await rodar(m)).toMatchObject({ aguardando: 1, escalados: 0 });
    expect(linha(m).reminder_escalation_claimed_at).toBeNull();
  });
});
