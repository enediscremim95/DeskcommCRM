import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FollowupsDoLead } from "@/components/leads/FollowupsDoLead";

const { alternar, estado } = vi.hoisted(() => ({
  alternar: vi.fn(),
  estado: { tarefas: [] as Array<Record<string, unknown>> },
}));

const FOLLOWUP = {
  id: "task-1",
  organization_id: "org-1",
  title: "Retomar negociação",
  description: "Enviar a proposta revisada",
  due_date: "2026-09-19T12:00:00.000Z",
  priority: "medium",
  status: "pending",
  lead_id: "lead-1",
  contact_id: "contact-1",
  assigned_to: null,
  created_by: "user-1",
  created_at: "2026-09-18T12:00:00.000Z",
  updated_at: "2026-09-18T12:00:00.000Z",
};

vi.mock("@/hooks/tasks/useTasks", () => ({
  useTasks: () => ({
    tarefas: estado.tarefas,
    carregando: false,
    falhou: false,
    criarTarefa: vi.fn(),
    alternarConcluida: alternar,
  }),
}));

vi.mock("@/app/app/tasks/_components/FormularioDeTarefa", () => ({
  FormularioDeTarefa: (props: {
    leadId?: string | null;
    contactId?: string | null;
    exigirPrazo?: boolean;
  }) => (
    <div
      data-testid="form-followup"
      data-lead-id={props.leadId}
      data-contact-id={props.contactId}
      data-exigir-prazo={String(props.exigirPrazo)}
    />
  ),
}));

describe("follow-ups dentro do lead", () => {
  beforeEach(() => {
    estado.tarefas = [FOLLOWUP];
    alternar.mockClear();
  });

  it("mantém a criação e a mensagem vazia no modo completo", () => {
    estado.tarefas = [];

    render(<FollowupsDoLead leadId="lead-1" contactId="contact-1" podeEditar />);

    expect(screen.getByRole("button", { name: "Follow-up" })).toBeInTheDocument();
    expect(screen.getByText("Nenhum follow-up marcado para este negócio.")).toBeInTheDocument();
    expect(screen.getByTestId("form-followup")).toBeInTheDocument();
  });

  it("não ocupa espaço no modo somente leitura quando não há follow-up", () => {
    estado.tarefas = [];

    const { container } = render(
      <FollowupsDoLead leadId="lead-1" contactId="contact-1" podeEditar modo="somenteLeitura" />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("mostra a lista e os controles de conclusão sem permitir criação no modo somente leitura", () => {
    render(
      <FollowupsDoLead leadId="lead-1" contactId="contact-1" podeEditar modo="somenteLeitura" />,
    );

    expect(screen.getByText("Retomar negociação")).toBeInTheDocument();
    expect(screen.getByText("Enviar a proposta revisada")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Follow-up" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("form-followup")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Marcar follow-up como feito" })).toBeInTheDocument();
  });

  it("usa o lead e o contato explícitos e permite concluir a pendência", () => {
    render(<FollowupsDoLead leadId="lead-1" contactId="contact-1" podeEditar />);

    expect(screen.getByText("Retomar negociação")).toBeInTheDocument();
    expect(screen.getByText("Enviar a proposta revisada")).toBeInTheDocument();
    expect(screen.getByTestId("form-followup")).toHaveAttribute("data-lead-id", "lead-1");
    expect(screen.getByTestId("form-followup")).toHaveAttribute("data-contact-id", "contact-1");
    expect(screen.getByTestId("form-followup")).toHaveAttribute("data-exigir-prazo", "true");

    fireEvent.click(screen.getByRole("button", { name: "Marcar follow-up como feito" }));
    expect(alternar).toHaveBeenCalledWith(expect.objectContaining({ id: "task-1" }));
  });
});
