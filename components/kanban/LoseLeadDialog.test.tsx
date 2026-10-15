import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LoseLeadDialog } from "./LoseLeadDialog";

const mutateAsync = vi.fn(async () => ({ data: { id: "lead-1" } }));

vi.mock("@/hooks/i18n/useT", () => ({
  useT: () => (texto: string) => texto,
}));

vi.mock("@/hooks/kanban/useUpdateLead", () => ({
  useLoseLead: () => ({ mutateAsync, isPending: false }),
}));

function renderDialog(lostReasons?: string[]) {
  return render(
    <LoseLeadDialog
      open
      onOpenChange={vi.fn()}
      leadId="lead-1"
      pipelineId="pipeline-1"
      lostReasons={lostReasons}
    />,
  );
}

beforeEach(() => mutateAsync.mockClear());
afterEach(cleanup);

describe("LoseLeadDialog", () => {
  it("mostra a lista do funil e envia o texto configurado literalmente", async () => {
    renderDialog(["Região indisponível", "Dados inválidos/Fake", "Outro"]);

    expect(screen.getByRole("radio", { name: "Região indisponível" })).toBeTruthy();
    expect(screen.queryByRole("radio", { name: "Preço" })).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: "Região indisponível" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        leadId: "lead-1",
        input: {
          lost_reason: "Região indisponível",
          lost_reason_detail: null,
        },
      }),
    );
  });

  it("usa a lista canônica quando o funil não tem motivos", () => {
    renderDialog([]);

    expect(screen.getByRole("radio", { name: "Cliente solicitou cancelamento" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Preço" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Outro motivo" })).toBeTruthy();
  });

  it("pede e envia detalhe para Outro configurado", async () => {
    renderDialog(["Outro"]);

    fireEvent.click(screen.getByRole("radio", { name: "Outro" }));
    fireEvent.change(screen.getByLabelText("Detalhe (opcional)"), {
      target: { value: "Região ainda não atendida" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        leadId: "lead-1",
        input: {
          lost_reason: "Outro",
          lost_reason_detail: "Região ainda não atendida",
        },
      }),
    );
  });
});
