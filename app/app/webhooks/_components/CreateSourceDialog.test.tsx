import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EntryOptionsData } from "@/hooks/webhooks/useWebhookSources";

import { CreateSourceDialog } from "./CreateSourceDialog";

const mocks = vi.hoisted(() => ({
  useEntryOptions: vi.fn(),
  mutateAsync: vi.fn(),
}));

vi.mock("@/hooks/webhooks/useWebhookSources", () => ({
  useEntryOptions: mocks.useEntryOptions,
  useCreateWebhookSource: () => ({ mutateAsync: mocks.mutateAsync, isPending: false }),
}));

vi.mock("@/hooks/inbox/useAssignableMembers", () => ({
  useAssignableMembers: () => ({
    data: [{ user_id: "user-1", full_name: "Ana" }],
    isLoading: false,
  }),
}));

function resposta(data: EntryOptionsData) {
  mocks.useEntryOptions.mockReturnValue({ data: { data }, isLoading: false });
}

function montar() {
  return render(<CreateSourceDialog open onOpenChange={() => {}} onCreated={() => {}} />);
}

async function irAoPassoDoDestino() {
  const user = userEvent.setup({ delay: null });
  montar();
  await user.type(screen.getByLabelText("Nome da página ou oferta"), "Página de pedidos");
  await user.click(screen.getByRole("button", { name: "Continuar" }));
  return user;
}

describe("CreateSourceDialog, destino coerente", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("abre com o funil padrão e a primeira etapa válida já selecionados", async () => {
    resposta({
      pipelines: [
        {
          id: "pipeline-outro",
          name: "Atendimento",
          position: 2000,
          is_default: false,
          vocabulary: { lead: "Cliente" },
          stages: [{ id: "triagem", name: "Triagem", position: 1000 }],
        },
        {
          id: "pipeline-pedidos",
          name: "Pedidos",
          position: 1000,
          is_default: true,
          vocabulary: { lead: "Pedido" },
          stages: [
            { id: "carrinho", name: "Carrinho abandonado", position: 1000 },
            { id: "aguardando", name: "Aguardando pagamento", position: 2000 },
          ],
        },
      ],
      default_pipeline_id: "pipeline-pedidos",
      default_stage_id: "carrinho",
    });

    await irAoPassoDoDestino();

    expect(screen.getByText("Passo 2 de 2: destino para Pedido")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Funil de entrada" })).toHaveTextContent("Pedidos");
    const etapa = screen.getByRole("combobox", { name: "Etapa de entrada" });
    expect(etapa).toHaveTextContent("Carrinho abandonado");

    expect(screen.queryByText("Pago")).not.toBeInTheDocument();
    expect(screen.queryByText("Cancelado")).not.toBeInTheDocument();
  });

  it("explica o funil sem etapa válida e bloqueia a criação", async () => {
    resposta({
      pipelines: [
        {
          id: "pipeline-pedidos",
          name: "Pedidos",
          position: 1000,
          is_default: true,
          vocabulary: { lead: "Pedido" },
          stages: [],
        },
      ],
      default_pipeline_id: "pipeline-pedidos",
      default_stage_id: null,
    });

    await irAoPassoDoDestino();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Não há etapa de entrada disponível para Pedido. Crie ou reabra uma etapa em Etapas do funil.",
    );
    expect(screen.getByRole("button", { name: "Criar fonte e gerar script" })).toBeDisabled();
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
  });
});
