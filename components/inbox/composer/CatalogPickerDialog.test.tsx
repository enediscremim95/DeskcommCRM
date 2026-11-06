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
  it("avisa quando o texto saiu sem a foto esperada", async () => {
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
      .mockResolvedValueOnce(
        resposta({
          data: {
            total: 1,
            sent: 1,
            queued: 0,
            failed: 0,
            results: [{ product_id: PRODUTO, status: "sent", photo: "missing" }],
          },
        }),
      );
    const onOpenChange = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={client}>
        <CatalogPickerDialog
          open
          onOpenChange={onOpenChange}
          conversationId="22222222-2222-4222-8222-222222222222"
        />
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByText("Caneca"));
    fireEvent.click(screen.getByRole("button", { name: "Enviar 1 produto(s)" }));

    await waitFor(() =>
      expect(toast.warning).toHaveBeenCalledWith(
        "Alguns produtos foram enviados sem foto. O texto foi mantido.",
      ),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
