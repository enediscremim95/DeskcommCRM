import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/client", () => ({
  apiClient: { post: vi.fn(), patch: vi.fn() },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/feedback/ApiErrorToast", () => ({ showApiError: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));

import { ProdutosClient } from "@/app/app/products/_client";
import type { Produto } from "@/lib/schemas/produtos";

const TEXTOS = { titulo: "Produtos", subtitulo: "", vazio: "", vazioDica: "" };

function produto(over: Partial<Produto> = {}): Produto {
  return {
    id: "11111111-1111-4111-8111-111111111111",
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
    updated_at: "2026-11-04T00:00:00.000Z",
    ...over,
  };
}

describe("produto vindo do painel na tela", () => {
  it("mostra o selo, bloqueia os campos do painel e libera só a legenda", () => {
    render(<ProdutosClient inicial={[produto()]} podeEditar textos={TEXTOS} />);

    expect(screen.getByText("Vem do painel")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("editar-SUBLI-1"));

    expect(screen.getByTestId("produto-codigo")).toBeDisabled();
    expect(screen.getByTestId("produto-nome")).toBeDisabled();
    expect(screen.getByTestId("produto-descricao")).toBeDisabled();
    expect(screen.getByTestId("produto-preco")).toBeDisabled();
    expect(screen.getByTestId("produto-legenda-atendimento")).not.toBeDisabled();
    expect(screen.queryByTestId("produto-imagem")).not.toBeInTheDocument();
    expect(screen.queryByTestId("alternar-SUBLI-1")).not.toBeInTheDocument();
  });

  it("avisa quando a imagem externa não será enviada como foto", () => {
    render(
      <ProdutosClient
        inicial={[
          produto({
            origem: "planilha",
            imagem_url: "https://cdn.example/foto.jpg",
          }),
        ]}
        podeEditar={false}
        textos={TEXTOS}
      />,
    );

    expect(screen.getByTestId("imagem-externa-SUBLI-1")).toHaveTextContent(
      "Imagem externa: no envio, este produto sai como texto.",
    );
  });
});
