import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  PriorityMetricSelector,
  priorityMetricStorageKey,
  reorderPriorityMetrics,
} from "./PriorityMetricSelector";

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (value: string) => value }));
vi.mock("@/lib/i18n/IdiomaProvider", () => ({ useIdioma: () => "pt-BR" }));

const baseProps = {
  organizationKey: "org-1",
  viewerKey: "user-1",
  model: "leads" as const,
  initial: ["spend", "reach"] as const,
};

describe("seletor de métricas prioritárias", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("aparece para quem não administra e salva a escolha apenas para a pessoa", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const onSaved = vi.fn();
    const user = userEvent.setup();
    const { unmount } = render(
      <PriorityMetricSelector
        {...baseProps}
        initial={[...baseProps.initial]}
        canManage={false}
        onSaved={onSaved}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Escolher métricas" });
    expect(trigger).toHaveClass("bg-surface-elevated", "h-11", "text-sm");
    await user.click(trigger);
    expect(
      screen.queryByRole("button", { name: "Definir como padrão da organização" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remover: Alcance" }));
    await user.click(
      screen.getByRole("button", { name: "Adicionar métrica prioritária: Faturamento" }),
    );
    await user.click(screen.getByRole("button", { name: "Salvar métricas prioritárias" }));

    const key = priorityMetricStorageKey("org-1", "user-1", "leads");
    expect(localStorage.getItem(key)).toBe(JSON.stringify(["spend", "revenue"]));
    expect(onSaved).toHaveBeenLastCalledWith(["spend", "revenue"]);
    expect(fetchMock).not.toHaveBeenCalled();

    unmount();
    const restored = vi.fn();
    render(
      <PriorityMetricSelector
        {...baseProps}
        initial={[...baseProps.initial]}
        canManage={false}
        onSaved={restored}
      />,
    );
    expect(restored).toHaveBeenLastCalledWith(["spend", "revenue"]);
  });

  it("volta ao padrão da organização e apaga a escolha pessoal", async () => {
    const key = priorityMetricStorageKey("org-1", "user-1", "leads");
    localStorage.setItem(key, JSON.stringify(["revenue", "spend"]));
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(
      <PriorityMetricSelector
        {...baseProps}
        initial={[...baseProps.initial]}
        canManage={false}
        onSaved={onSaved}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Escolher métricas" }));
    expect(screen.getByText("Esta é a sua visualização pessoal.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Voltar ao padrão" }));

    expect(localStorage.getItem(key)).toBeNull();
    expect(onSaved).toHaveBeenLastCalledWith(["spend", "reach"]);
    expect(screen.queryByText("Esta é a sua visualização pessoal.")).not.toBeInTheDocument();
  });

  it("reserva a mudança do padrão da organização para admin da plataforma", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ data: { priority_metrics: ["spend", "reach"] } }));
    const user = userEvent.setup();
    render(
      <PriorityMetricSelector
        {...baseProps}
        initial={[...baseProps.initial]}
        canManage
        onSaved={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Escolher métricas" }));
    await user.click(screen.getByRole("button", { name: "Definir como padrão da organização" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/reports/traffic",
      expect.objectContaining({ body: JSON.stringify({ priority_metrics: ["spend", "reach"] }) }),
    );
  });

  it("reordena sem duplicar nem perder cartões", () => {
    expect(reorderPriorityMetrics(["spend", "reach", "leads"], 2, 0)).toEqual([
      "leads",
      "spend",
      "reach",
    ]);
  });
});
