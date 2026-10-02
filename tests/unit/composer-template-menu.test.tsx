import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { resolveSlash, TemplateMenu } from "@/components/inbox/composer/TemplateMenu";

describe("resolveSlash", () => {
  it("abre com / no início e captura o query", () => {
    expect(resolveSlash("/fech")).toEqual({ open: true, query: "fech" });
    expect(resolveSlash("/")).toEqual({ open: true, query: "" });
  });
  it("não abre se tem espaço ou não começa com /", () => {
    expect(resolveSlash("/fech agora").open).toBe(false);
    expect(resolveSlash("oi")).toEqual({ open: false, query: "" });
    expect(resolveSlash("R$ 10/20")).toEqual({ open: false, query: "" });
  });
});

describe("TemplateMenu", () => {
  const templates = [
    { id: "1", title: "Saudação", body: "Oi {{primeiro_nome}}", shortcut: "oi" },
    { id: "2", title: "Fechamento", body: "Fechado!", shortcut: "fech" },
  ];
  it.each([
    ["fecha", "Fechamento"],
    ["oi", "Saudação"],
  ])("filtra '%s' por título ou atalho", (query, esperado) => {
    const onPick = vi.fn();
    render(
      <TemplateMenu
        open
        query={query}
        templates={templates as never}
        activeIndex={0}
        onPick={onPick}
        onActiveIndexChange={() => {}}
      />,
    );

    expect(screen.getByRole("option", { name: new RegExp(esperado, "i") })).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });

  it("anuncia o item ativo e devolve o escolhido", () => {
    const onPick = vi.fn();
    render(
      <TemplateMenu
        open
        query=""
        templates={templates as never}
        activeIndex={1}
        onPick={onPick}
        onActiveIndexChange={() => {}}
      />,
    );

    const item = screen.getByRole("option", { name: /fechamento/i });
    expect(item).toHaveAttribute("aria-selected", "true");
    fireEvent.click(item);
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "2" }));
  });
});
