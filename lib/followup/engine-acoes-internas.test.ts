import { describe, expect, it, vi } from "vitest";

import { runFollowupTick, type AdminClient } from "./engine";
import { actionConfigSchema } from "./graph-schema";
import { processNode, type EnrollmentRow, type EnrollmentEventRef } from "./node-handlers";

const now = new Date("2026-11-24T15:00:00Z");

function enrollment(over: Partial<EnrollmentRow> = {}): EnrollmentRow {
  return {
    id: "enr-1",
    organization_id: "org-A",
    pointer_id: "ptr-1",
    version_id: "v1",
    contact_id: "contato-1",
    conversation_id: "conv-1",
    current_node_id: "tarefa",
    status: "active",
    next_eval_at: null,
    claimed_until: null,
    attempts: 0,
    max_attempts: 5,
    last_error: null,
    steps_taken: 3,
    outcome: null,
    cancel_reason: null,
    started_at: now.toISOString(),
    completed_at: null,
    updated_at: now.toISOString(),
    ...over,
  };
}

function grafo(config: unknown) {
  return {
    nodes: [
      { id: "tarefa", type: "action", label: "Tarefa", position: { x: 0, y: 0 }, config },
      { id: "fim", type: "end", label: "Fim", position: { x: 1, y: 0 }, config: { outcome: "exhausted" } },
    ],
    edges: [{ id: "e1", source: "tarefa", target: "fim", priority: 0, condition: { type: "always" } }],
  };
}

function montarDb(config: unknown, eventos: EnrollmentEventRef[] = [], extra: Partial<AdminClient> = {}) {
  const insertEnrollmentEvent = vi.fn().mockResolvedValue({ inserted: true });
  const updateEnrollment = vi.fn().mockResolvedValue(undefined);
  const criarTarefaHumana = vi.fn().mockResolvedValue({
    taskId: "task-1",
    criada: true,
    avisoAberto: true,
    assignedTo: "sdr-1",
    origem: "responsavel_do_numero",
    leadId: "lead-1",
    conversationId: "conv-1",
  });
  const moverEtapa = vi.fn().mockResolvedValue({ movido: false, motivo: "sem_destino" });
  const db = {
    claimDueEnrollments: async () => [enrollment()],
    loadFlowGraph: async () => grafo(config),
    loadLeadFacts: async () => ({ lead_stage: "etapa-1", tags: [], contact_name: "Maria" }),
    loadEnrollmentEvents: async () => eventos,
    insertEnrollmentEvent,
    updateEnrollment,
    criarTarefaHumana,
    moverEtapa,
    ...extra,
  } as unknown as AdminClient;
  return { db, insertEnrollmentEvent, updateEnrollment, criarTarefaHumana, moverEtapa };
}

describe("schema das ações internas", () => {
  it("aceita tarefa humana e mover etapa sem destino; recusa título vazio", () => {
    expect(actionConfigSchema.safeParse({ mode: "human_task", title: "Ligar para {{nome}}" }).success).toBe(true);
    expect(actionConfigSchema.safeParse({ mode: "move_stage" }).success).toBe(true);
    expect(actionConfigSchema.safeParse({ mode: "human_task", title: "   " }).success).toBe(false);
    expect(actionConfigSchema.safeParse({ mode: "move_stage", stage_id: "nao-uuid" }).success).toBe(false);
  });
});

describe("processNode — ação interna avança sem turno de envio", () => {
  it.each(["human_task", "move_stage"] as const)("%s devolve advance com efeito, nunca enqueue_turn", (mode) => {
    const g = grafo(mode === "human_task" ? { mode, title: "Ligar" } : { mode });
    const r = processNode({
      node: g.nodes[0] as never,
      edges: g.edges as never,
      enrollment: enrollment(),
      lead: { lead_stage: null, tags: [], steps_taken: 3, last_outcome: null },
      clock: () => now,
    });
    expect(r).toEqual({ kind: "advance", next_node_id: "fim", next_eval_at: now, efeito: mode });
  });
});

describe("engine — tarefa humana", () => {
  it("cria a tarefa com nome interpolado e chave do passo, e NÃO enfileira envio ao contato", async () => {
    const { db, criarTarefaHumana, insertEnrollmentEvent, updateEnrollment } = montarDb({
      mode: "human_task",
      title: "Ligar para {{nome}}",
      description: "Toque 2 da cadência",
      priority: "urgent",
      due_in_minutes: 30,
    });
    const enqueueJob = vi.fn();
    const r = await runFollowupTick({ db, enqueueJob, clock: () => now });

    expect(r).toMatchObject({ advanced: 1, failed: 0 });
    expect(enqueueJob).not.toHaveBeenCalled();
    expect(criarTarefaHumana).toHaveBeenCalledTimes(1);
    expect(criarTarefaHumana).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-A",
        sourceKey: "followup:enr-1:tarefa:3",
        title: "Ligar para Maria",
        description: "Toque 2 da cadência",
        priority: "urgent",
        dueAt: new Date(now.getTime() + 30 * 60_000),
        contactId: "contato-1",
        conversationId: "conv-1",
      }),
    );
    expect(insertEnrollmentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: "human_task_created",
        idempotency_key: "tarefa:3",
        payload: expect.objectContaining({ task_id: "task-1", assigned_to: "sdr-1", origem: "responsavel_do_numero" }),
      }),
    );
    expect(updateEnrollment).toHaveBeenCalledWith(
      "enr-1",
      "org-A",
      expect.objectContaining({ current_node_id: "fim", status: "active" }),
    );
  });

  it("replay do mesmo passo (evento já gravado) não recria a tarefa e ainda avança", async () => {
    const { db, criarTarefaHumana, updateEnrollment } = montarDb(
      { mode: "human_task", title: "Ligar" },
      [{ node_id: "tarefa", idempotency_key: "tarefa:3", event_type: "human_task_created", payload: {} }],
      { insertEnrollmentEvent: vi.fn().mockResolvedValue({ inserted: false }) } as Partial<AdminClient>,
    );
    await runFollowupTick({ db, enqueueJob: vi.fn(), clock: () => now });
    expect(criarTarefaHumana).not.toHaveBeenCalled();
    expect(updateEnrollment).toHaveBeenCalledWith("enr-1", "org-A", expect.objectContaining({ current_node_id: "fim" }));
  });

  it("falha de banco ao criar a tarefa vira retry com backoff, não avanço", async () => {
    const { db, updateEnrollment } = montarDb({ mode: "human_task", title: "Ligar" }, [], {
      criarTarefaHumana: vi.fn().mockRejectedValue(new Error("db fora")),
    } as Partial<AdminClient>);
    const r = await runFollowupTick({ db, enqueueJob: vi.fn(), clock: () => now });
    expect(r).toMatchObject({ failed: 1, advanced: 0 });
    expect(updateEnrollment).toHaveBeenCalledWith("enr-1", "org-A", expect.objectContaining({ attempts: 1 }));
  });
});

describe("engine — mover etapa", () => {
  it("sem destino é no-op seguro: grava o motivo e segue o fluxo", async () => {
    const { db, moverEtapa, insertEnrollmentEvent, updateEnrollment } = montarDb({ mode: "move_stage" });
    const enqueueJob = vi.fn();
    await runFollowupTick({ db, enqueueJob, clock: () => now });
    expect(moverEtapa).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-A", contactId: "contato-1", stageId: null, flowPointerId: "ptr-1" }),
    );
    expect(insertEnrollmentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: "stage_move_skipped", payload: expect.objectContaining({ motivo: "sem_destino" }) }),
    );
    expect(updateEnrollment).toHaveBeenCalledWith("enr-1", "org-A", expect.objectContaining({ current_node_id: "fim" }));
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it("movimento aceito grava stage_move_done", async () => {
    const stage = "11111111-1111-4111-8111-111111111111";
    const { db, insertEnrollmentEvent } = montarDb({ mode: "move_stage", stage_id: stage }, [], {
      moverEtapa: vi.fn().mockResolvedValue({ movido: true, lead_id: "lead-1", to_stage_id: stage }),
    } as Partial<AdminClient>);
    await runFollowupTick({ db, enqueueJob: vi.fn(), clock: () => now });
    expect(insertEnrollmentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: "stage_move_done", payload: expect.objectContaining({ to_stage_id: stage }) }),
    );
  });
});

describe("engine — mover etapa usa a origem da inscrição", () => {
  it("repassa o lead_id do evento enrolled_by_* (e ignora lead_id de outros eventos)", async () => {
    const { db, moverEtapa } = montarDb({ mode: "move_stage" }, [
      { node_id: "trigger", idempotency_key: "x", event_type: "stage_move_done", payload: { lead_id: "lead-errado" } },
      { node_id: "trigger", idempotency_key: "gatilho-etapa:1", event_type: "enrolled_by_stage_change", payload: { lead_id: "lead-origem" } },
    ]);
    await runFollowupTick({ db, enqueueJob: vi.fn(), clock: () => now });
    expect(moverEtapa).toHaveBeenCalledWith(expect.objectContaining({ origemLeadId: "lead-origem" }));
  });

  it("sem evento de inscrição com lead: origem nula", async () => {
    const { db, moverEtapa } = montarDb({ mode: "move_stage" });
    await runFollowupTick({ db, enqueueJob: vi.fn(), clock: () => now });
    expect(moverEtapa).toHaveBeenCalledWith(expect.objectContaining({ origemLeadId: null }));
  });
});

