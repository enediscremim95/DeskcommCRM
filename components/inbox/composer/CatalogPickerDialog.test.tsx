import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CatalogPickerDialog } from "./CatalogPickerDialog";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));
vi.mock("@/hooks/i18n/useT", () => {
  const t = (texto: string) => texto;
  return { useT: () => t };
});

const PRODUTO = "11111111-1111-4111-8111-111111111111";

function resposta(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("seletor de produtos da conversa", () => {
  it("chama somente a rota de rascunho e entrega os itens ao compositor", async () => {
    const rascunho = {
      product_id: PRODUTO,
      nome: "Caneca",
      legenda: "Caneca\nR$ 49,90\nDescrição inteira",
      excede_limite: false,
      foto: null,
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        resposta({
          data: [
            {
              id: PRODUTO,
              codigo: "SUBLI-1",
              nome: "Caneca",
              descricao: "Descrição",
              marca: null,
              categoria: null,
              preco_cents: 4990,
              moeda: "BRL",
              custo_cents: null,
              controla_estoque: false,
              quantidade: 0,
              ativo: true,
              origem: "painel",
              imagem_url: null,
              imagem_origem_url: null,
              legenda_atendimento: null,
              updated_at: "2026-11-06T00:00:00.000Z",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(resposta({ data: [rascunho] }));
    const onOpenChange = vi.fn();
    const onDrafts = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={client}>
        <CatalogPickerDialog
          open
          onOpenChange={onOpenChange}
          conversationId="22222222-2222-4222-8222-222222222222"
          onDrafts={onDrafts}
        />
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByText("Caneca"));
    fireEvent.click(screen.getByRole("button", { name: "Adicionar ao rascunho" }));

    await waitFor(() => expect(onDrafts).toHaveBeenCalledWith([rascunho]));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "/api/v1/conversations/22222222-2222-4222-8222-222222222222/catalog-items/draft",
    );
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).endsWith(
          "/api/v1/conversations/22222222-2222-4222-8222-222222222222/catalog-items",
        ),
      ),
    ).toBe(false);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(toast.warning).not.toHaveBeenCalled();
  });
});
