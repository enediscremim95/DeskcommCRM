import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("rolagem vertical por coluna no quadro", () => {
  it("limita o quadro à viewport no desktop sem mudar o piso do mobile", () => {
    const page = readFileSync("app/app/pipelines/[id]/_client.tsx", "utf8");
    const board = readFileSync("components/kanban/KanbanBoard.tsx", "utf8");

    expect(page).toContain("min-h-[600px]");
    expect(page).toContain("md:h-[calc(100dvh-8.75rem)]");
    expect(page).toContain("md:min-h-0");
    expect(page).toMatch(/<header className="[^"]*\bshrink-0\b/);
    expect(page).toContain('<div className="shrink-0">\n        <FilterBar');

    expect(board).toContain("min-h-[480px]");
    expect(board).toContain("md:min-h-0");
    expect(board).toContain("md:items-stretch");
    expect(board).toContain("md:overflow-y-hidden");
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
        "overflow-y-auto",
        "overscroll-contain",
        "[scrollbar-gutter:stable]",
      ]),
    );
  });
});
