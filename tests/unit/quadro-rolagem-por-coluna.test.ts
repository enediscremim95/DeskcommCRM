import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("rolagem vertical por coluna no quadro", () => {
  it("mede o espaço real do quadro sem manter a estimativa fixa na página", () => {
    const route = readFileSync("app/app/pipelines/[id]/page.tsx", "utf8");
    const page = readFileSync("app/app/pipelines/[id]/_client.tsx", "utf8");
    const filters = readFileSync("components/kanban/FilterBar.tsx", "utf8");
    const board = readFileSync("components/kanban/KanbanBoard.tsx", "utf8");
    const card = readFileSync("components/kanban/KanbanCard.tsx", "utf8");

    expect(route).toContain("flex min-h-[640px] flex-col gap-4 p-6 md:pb-0");
    expect(page).toContain("min-h-[600px]");
    expect(page).toContain("md:min-h-0");
    expect(page).not.toContain("h-[calc(100dvh");
    expect(page).toContain('<h1 className="sr-only">');
    expect(page).not.toContain("<header className=");
    expect(page).toContain('<div className="shrink-0">\n        <FilterBar');
    expect(page).toMatch(
      /<Button onClick=\{\(\) => setNewOpen\(true\)\} disabled=\{!data\} size="sm">/,
    );
    expect(filters).toContain('className="ml-auto flex flex-wrap items-center gap-2"');

    expect(board).toContain("useAlturaAteORodape<HTMLDivElement>()");
    const dragScrollProps = board.match(/<DragScroll([\s\S]*?)>/)?.[1];
    expect(dragScrollProps).toContain("containerRef={quadroRef}");
    expect(dragScrollProps).toContain('eixo="x"');
    expect(dragScrollProps).toContain('naoIniciaEm="[data-quadro-card]"');
    expect(dragScrollProps).toContain("quadro-rolagem-x");
    expect(dragScrollProps).toContain("min-h-[480px]");
    expect(dragScrollProps).toContain("md:min-h-0");
    expect(dragScrollProps).toContain("md:items-stretch");
    expect(dragScrollProps).toContain("overflow-x-auto overflow-y-hidden");
    expect(card).toContain("data-quadro-card");
  });

  it("impede que os cards encolham dentro da coluna rolável", () => {
    const card = readFileSync("components/kanban/KanbanCard.tsx", "utf8");
    const rootClasses = card.match(
      /data-quadro-card[\s\S]*?className=\{cn\(\s*"([^"]+)"/,
    )?.[1];

    // Sem shrink-0, o overflow-hidden reduz o card a 16 px no flex vertical da coluna.
    expect(rootClasses?.split(" ")).toEqual(
      expect.arrayContaining(["overflow-hidden", "shrink-0"]),
    );
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
    expect(column).toContain(
      'className="flex min-h-10 shrink-0 items-center justify-center',
    );
    expect(column).toContain(
      'className="flex h-16 shrink-0 items-center justify-center',
    );
  });

  it("define barras finas, arredondadas e temáticas para os dois eixos", () => {
    const css = readFileSync("app/globals.css", "utf8");

    expect(css).toContain(":where(.quadro-rolagem-x, .quadro-rolagem-y)");
    expect(css).toContain("scrollbar-width: thin");
    expect(css).toContain("scrollbar-color: var(--color-neutral-400) transparent");
    expect(css).toMatch(/::-webkit-scrollbar\s*\{[\s\S]*?width: 8px;[\s\S]*?height: 8px;/);
    expect(css).toMatch(
      /::-webkit-scrollbar-thumb\s*\{[\s\S]*?border-radius: var\(--radius-full\);/,
    );
    expect(css).toContain("background-color: var(--color-neutral-300)");
    expect(css).toContain("::-webkit-scrollbar-button");
  });
});
