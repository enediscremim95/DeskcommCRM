import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DeleteLeadDialog } from "@/components/leads/DeleteLeadDialog";

const { mutate } = vi.hoisted(() => ({ mutate: vi.fn() }));

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (texto: string) => texto }));
vi.mock("@/hooks/kanban/useBulkAction", () => ({
  useBulkAction: () => ({ mutate, isPending: false }),
}));

describe("confirmação para excluir leads", () => {
  it("nomeia o lead e envia a exclusão pela rota em lote", () => {
    const onDeleted = vi.fn();
    const onOpenChange = vi.fn();
    mutate.mockImplementationOnce(
      (
        _input: unknown,
        options: { onSuccess?: (result: { data: { updated_count: number } }) => void },
      ) => options.onSuccess?.({ data: { updated_count: 1 } }),
    );

    render(
      <DeleteLeadDialog
        open
        onOpenChange={onOpenChange}
        pipelineId="pipeline-1"
        leadIds={["lead-1"]}
        leadTitle="[deploy-check] verificação automática"
        onDeleted={onDeleted}
      />,
    );

    expect(
      screen.getByRole("heading", {
        name: "Excluir o lead “[deploy-check] verificação automática”?",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/não pode ser desfeita/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Excluir" }));

    expect(mutate).toHaveBeenCalledWith(
      { action: "delete", lead_ids: ["lead-1"], params: {} },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onDeleted).toHaveBeenCalledOnce();
  });

  it("mostra a quantidade no lote e a irreversibilidade", () => {
    render(
      <DeleteLeadDialog
        open
        onOpenChange={vi.fn()}
        pipelineId="pipeline-1"
        leadIds={["lead-1", "lead-2", "lead-3"]}
      />,
    );

    expect(screen.getByRole("heading", { name: "Excluir 3 selecionados?" })).toBeInTheDocument();
    expect(
      screen.getByText(/leads selecionados serão excluídos permanentemente/i),
    ).toBeInTheDocument();
  });
});
