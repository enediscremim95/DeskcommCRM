import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  montaAlertasDoRadar,
  prazoDaTarefa,
  RiskRadarList,
} from "@/app/app/radar/_components/RiskRadarList";
import type { AtRiskData } from "@/hooks/leads/useAtRiskLeads";

const AGORA = new Date("2026-09-18T12:00:00.000Z");

const data: AtRiskData = {
  counts: { critico: 2, em_risco: 2, em_voo: 1 },
  total: 5,
  sem_proximo_passo: [],
  total_sem_proximo_passo: 0,
  tasks: [
    {
      id: "task-overdue",
      title: "Ligar para confirmar a proposta",
      description: null,
      due_date: "2026-09-18T10:00:00.000Z",
      status: "pending",
      lead_id: "lead-overdue",
      contact_id: "contact-maria",
      lead_title: "Proposta da Maria",
      contact_name: "Maria",
    },
    {
      id: "task-soon",
      title: "Enviar relatório mensal",
      description: null,
      due_date: "2026-09-18T14:00:00.000Z",
      status: "in_progress",
      lead_id: null,
      contact_id: null,
    },
    {
      id: "task-later",
      title: "Só amanhã à noite",
      description: null,
      due_date: "2026-09-19T18:00:00.000Z",
      status: "pending",
      lead_id: null,
      contact_id: null,
    },
  ],
  items: [
    {
      id: "lead-stalled",
      title: "Proposta parada",
      contact_id: "contact-julia",
      contact_name: "Júlia",
      owner_user_id: null,
      owner_kind: null,
      owner_agent_id: null,
      owner_agent_name: null,
      assignee_kind: null,
      last_activity_at: "2026-09-13T12:00:00.000Z",
      hours_since_activity: 120,
      risk: "critico",
      in_flight: false,
      next_followup_at: null,
      manual_followup: null,
      conversation_id: null,
      pipeline_id: "pipeline-1",
      stage_name: "Proposta",
      has_open_task: false,
    },
    {
      id: "lead-in-flight",
      title: "Já protegido",
      contact_id: "contact-2",
      contact_name: "Caio",
      owner_user_id: null,
      owner_kind: null,
      owner_agent_id: null,
      owner_agent_name: null,
      assignee_kind: null,
      last_activity_at: "2026-09-13T12:00:00.000Z",
      hours_since_activity: 120,
      risk: "em_voo",
      in_flight: true,
      next_followup_at: "2026-09-19T12:00:00.000Z",
      manual_followup: null,
      conversation_id: null,
      pipeline_id: "pipeline-1",
      stage_name: "Proposta",
      has_open_task: false,
    },
    {
      id: "lead-with-task",
      title: "Já tem tarefa",
      contact_id: "contact-3",
      contact_name: "Ana",
      owner_user_id: null,
      owner_kind: null,
      owner_agent_id: null,
      owner_agent_name: null,
      assignee_kind: null,
      last_activity_at: "2026-09-14T12:00:00.000Z",
      hours_since_activity: 96,
      risk: "em_risco",
      in_flight: false,
      next_followup_at: null,
      manual_followup: null,
      conversation_id: null,
      pipeline_id: "pipeline-1",
      stage_name: "Negociação",
      has_open_task: true,
    },
  ],
};

vi.mock("@/hooks/leads/useAtRiskLeads", () => ({
  useAtRiskLeads: () => ({ isLoading: false, data }),
}));

describe("Radar somente com alertas acionáveis", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(AGORA);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("mantém apenas vencidos, próximas 24 h e lead parado sem próximo passo", () => {
    const alertas = montaAlertasDoRadar(data, AGORA);
    expect(
      alertas.map((alerta) =>
        alerta.tipo === "tarefa" ? alerta.tarefa.id : alerta.lead.id,
      ),
    ).toEqual(["task-overdue", "lead-stalled", "task-soon"]);
  });

  it("renderiza cards compactos e abre o formulário de follow-up sem sair do Radar", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <RiskRadarList />
      </QueryClientProvider>,
    );

    expect(screen.getAllByTestId("radar-item")).toHaveLength(3);
    expect(screen.getByText("Ligar para confirmar a proposta")).toBeInTheDocument();
    expect(screen.getByText("Com Maria")).toBeInTheDocument();
    expect(screen.getByText("Júlia")).toBeInTheDocument();
    expect(screen.getByText("Proposta")).toBeInTheDocument();
    expect(screen.queryByText("Só amanhã à noite")).not.toBeInTheDocument();
    expect(screen.queryByText("Já protegido")).not.toBeInTheDocument();
    expect(screen.queryByText("Já tem tarefa")).not.toBeInTheDocument();
    expect(screen.queryByTestId("radar-counts")).not.toBeInTheDocument();
    expect(screen.queryByTestId("radar-sem-proximo-passo")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Marcar follow-up" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Marcar follow-up" })).toBeInTheDocument();
  });

  it("explica prazo futuro e atraso em linguagem direta", () => {
    expect(prazoDaTarefa("2026-09-18T14:00:00.000Z", AGORA)).toBe("vence em 2 h");
    expect(prazoDaTarefa("2026-09-19T12:00:00.000Z", AGORA)).toBe("vence em 24 h");
    expect(prazoDaTarefa("2026-09-17T12:00:00.000Z", AGORA)).toBe("atrasada há 1 dia");
  });
});
