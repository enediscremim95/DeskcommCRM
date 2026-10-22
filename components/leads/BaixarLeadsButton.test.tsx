import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BaixarLeadsButton } from "@/components/leads/BaixarLeadsButton";
import { IdiomaProvider } from "@/lib/i18n/IdiomaProvider";

describe("BaixarLeadsButton", () => {
  it("é uma âncora direta para a rota, sem etapa intermediária", () => {
    render(<BaixarLeadsButton />);

    const link = screen.getByRole("link", { name: "Baixar leads" });
    expect(link).toHaveAttribute("href", "/api/v1/leads/export");
    expect(link).toHaveAttribute("download");
  });

  it("mostra o texto em espanhol", () => {
    render(
      <IdiomaProvider locale="es">
        <BaixarLeadsButton />
      </IdiomaProvider>,
    );

    expect(screen.getByRole("link", { name: "Descargar leads" })).toBeInTheDocument();
  });
});
