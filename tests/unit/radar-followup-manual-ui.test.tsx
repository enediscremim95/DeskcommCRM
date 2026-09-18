import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  prazoDaTarefa,
  RiskRadarList,
} from "@/app/app/radar/_components/RiskRadarList";

vi.mock("@/hooks/inbox/useClaimConversation", () => ({
  useClaimConversation: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/leads/useAtRiskLeads", () => ({
  useAtRiskLeads: () => ({
    isLoading: false,
    data: {
      counts: { critico: 0, em_risco: 1, em_voo: 0 },
      total: 1,
      sem_proximo_passo: [],
      total_sem_proximo_passo: 0,
      tasks: [
        {
          id: "task-generic-1",
          title: "Enviar relatório mensal",
          description: "Tarefa criada sem lead nem contato",
          due_date: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
          status: "pending",
          lead_id: null,
          contact_id: null,
        },
      ],
      items: [
        {
          id: "lead-1",
          title: "Proposta da Maria",
          contact_id: "contact-1",
          contact_name: "Maria",
          owner_user_id: "user-1",
          owner_kind: "user",
          owner_agent_id: null,
          owner_agent_name: null,
          assignee_kind: "user",
          last_activity_at: new Date().toISOString(),
          hours_since_activity: 2,
          risk: "em_risco",
          in_flight: false,
          next_followup_at: null,
          manual_followup: {
            id: "task-1",
            title: "Ligar para confirmar a proposta",
            description: "Perguntar sobre a forma de pagamento",
            due_date: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
            open_count: 1,
          },
          conversation_id: "conversation-1",
          pipeline_id: "pipeline-1",
        },
      ],
    },
  }),
}));

describe("Radar com follow-up humano", () => {
  it("mostra o que fazer e abre o dossiê exato do lead", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <RiskRadarList />
      </QueryClientProvider>,
    );

    expect(screen.getByText("Ligar para confirmar a proposta")).toBeInTheDocument();
    expect(screen.getByText("Perguntar sobre a forma de pagamento")).toBeInTheDocument();
    expect(screen.getByTestId("radar-followup-manual")).toBeInTheDocument();
    expect(screen.getByTestId("radar-tarefas")).toBeInTheDocument();
    expect(screen.getByText("Enviar relatório mensal")).toBeInTheDocument();
    expect(screen.getByText("Tarefa criada sem lead nem contato")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver todas" })).toHaveAttribute("href", "/app/tasks");
    expect(screen.getByText("Proposta da Maria").closest("a")).toHaveAttribute(
      "href",
      "/app/pipelines/pipeline-1?lead=lead-1",
    );
  });

  it("explica prazo futuro e atraso em linguagem direta", () => {
    const agora = new Date("2026-09-18T12:00:00.000Z");
    expect(prazoDaTarefa("2026-09-18T14:00:00.000Z", agora)).toBe("vence em 2 h");
    expect(prazoDaTarefa("2026-09-19T14:00:00.000Z", agora)).toBe("vence amanhã");
    expect(prazoDaTarefa("2026-09-17T12:00:00.000Z", agora)).toBe("atrasada há 1 dia");
  });
});
