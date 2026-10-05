import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("rolagem vertical por coluna no quadro", () => {
  it("mede o espaço real do quadro sem manter a estimativa fixa na página", () => {
    const page = readFileSync("app/app/pipelines/[id]/_client.tsx", "utf8");
    const board = readFileSync("components/kanban/KanbanBoard.tsx", "utf8");

    expect(page).toContain("min-h-[600px]");
    expect(page).toContain("md:min-h-0");
    expect(page).not.toContain("h-[calc(100dvh");
    expect(page).toMatch(/<header className="[^"]*\bshrink-0\b/);
    expect(page).toContain('<div className="shrink-0">\n        <FilterBar');

    expect(board).toContain('useAlturaAteORodape<HTMLDivElement>()');
    expect(board).toContain("ref={quadroRef}");
    expect(board).toContain("quadro-rolagem-x");
    expect(board).toContain("min-h-[480px]");
    expect(board).toContain("md:min-h-0");
    expect(board).toContain("md:items-stretch");
    expect(board).toContain("overflow-x-auto overflow-y-hidden");
  });

  it("mantém o cabeçalho da etapa fixo e rola no próprio Droppable", () => {
    const column = readFileSync("components/kanban/StageColumn.tsx", "utf8");

    expect(column).toContain("max-h-full min-h-0");
    expect(column).toContain('className="group/etapa shrink-0');
    const droppableClasses = column.match(
      /\.\.\.provided\.droppableProps[\s\S]*?className=\{cn\(\s*"([^"]+)"/,
    )?.[1];
    expect(droppableClasses?.split(" ")).toEqual(
      expect.arrayContaining([
        "min-h-0",
        "flex-1",
        "quadro-rolagem-y",
        "overflow-y-auto",
        "overscroll-contain",
        "[scrollbar-gutter:stable]",
      ]),
    );
  });

  it("define barras finas, arredondadas e temáticas para os dois eixos", () => {
    const css = readFileSync("app/globals.css", "utf8");

    expect(css).toContain(":where(.quadro-rolagem-x, .quadro-rolagem-y)");
    expect(css).toContain("scrollbar-width: thin");
    expect(css).toContain("scrollbar-color: var(--color-neutral-400) transparent");
    expect(css).toMatch(/::-webkit-scrollbar\s*\{[\s\S]*?width: 8px;[\s\S]*?height: 8px;/);
    expect(css).toMatch(/::-webkit-scrollbar-thumb\s*\{[\s\S]*?border-radius: var\(--radius-full\);/);
    expect(css).toContain("background-color: var(--color-neutral-300)");
    expect(css).toContain("::-webkit-scrollbar-button");
  });
});
