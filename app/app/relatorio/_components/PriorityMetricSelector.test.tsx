import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PriorityMetricSelector, reorderPriorityMetrics } from "./PriorityMetricSelector";

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (value: string) => value }));
vi.mock("@/lib/i18n/IdiomaProvider", () => ({ useIdioma: () => "pt-BR" }));

describe("seletor de métricas prioritárias", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("não aparece para quem está em somente leitura", () => {
    render(
      <PriorityMetricSelector
        model="leads"
        initial={["spend", "leads"]}
        canManage={false}
        onSaved={vi.fn()}
      />,
    );
    expect(screen.queryByText("Escolher métricas")).not.toBeInTheDocument();
  });

  it("salva a escolha feita e mantém a ordem", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ data: { priority_metrics: ["spend", "revenue"] } }));
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(
      <PriorityMetricSelector
        model="leads"
        initial={["spend", "reach"]}
        canManage
        onSaved={onSaved}
      />,
    );

    await user.click(screen.getByText("Escolher métricas"));
    await user.click(screen.getByRole("button", { name: "Remover: Alcance" }));
    await user.click(
      screen.getByRole("button", { name: "Adicionar métrica prioritária: Faturamento" }),
    );
    await user.click(screen.getByRole("button", { name: "Salvar métricas prioritárias" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/reports/traffic",
      expect.objectContaining({ body: JSON.stringify({ priority_metrics: ["spend", "revenue"] }) }),
    );
    expect(onSaved).toHaveBeenCalledWith(["spend", "revenue"]);
  });

  it("reordena sem duplicar nem perder cartões", () => {
    expect(reorderPriorityMetrics(["spend", "reach", "leads"], 2, 0)).toEqual([
      "leads",
      "spend",
      "reach",
    ]);
  });
});
