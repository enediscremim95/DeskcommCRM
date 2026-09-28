import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { applyPaginatedMove, positionForPaginatedDrop } from "@/lib/kanban/paginated-move";
import type { BoardData } from "@/lib/kanban/types";
import type { Lead } from "@/lib/types/leads";

const lead = (id: string, stageId: string, position: number) =>
  ({ id, stage_id: stageId, position_in_stage: position }) as Lead;

describe("arrasto com coluna parcialmente carregada", () => {
  it("posiciona antes do primeiro card ainda não carregado", () => {
    const loaded = [lead("a", "destino", 49_000), lead("b", "destino", 50_000)];

    expect(positionForPaginatedDrop(loaded, 2, "movido", 51_000)).toBe(50_500);
  });

  it("atualiza as contagens reais no movimento otimista entre etapas", () => {
    const board = {
      leads: [lead("movido", "origem", 1_000)],
      stage_pages: {
        origem: { total: 101, cursor: "a", has_more: true, next_position_in_stage: 51_000 },
        destino: { total: 230, cursor: "b", has_more: true, next_position_in_stage: 71_000 },
      },
    } as unknown as BoardData;

    const moved = applyPaginatedMove(board, {
      leadId: "movido",
      stageId: "destino",
      positionInStage: 50_500,
    });

    expect(moved.leads[0]).toMatchObject({ stage_id: "destino", position_in_stage: 50_500 });
    expect(moved.stage_pages?.origem?.total).toBe(100);
    expect(moved.stage_pages?.destino?.total).toBe(231);
  });

  it("o quadro usa o limite do primeiro card ainda não carregado", () => {
    const board = readFileSync("components/kanban/KanbanBoard.tsx", "utf8");

    expect(board).toContain("positionForPaginatedDrop(");
    expect(board).toContain("next_position_in_stage ?? null");
  });
});

describe("erro útil no quadro", () => {
  it("não mostra o erro cru e oferece uma nova tentativa", () => {
    const page = readFileSync("app/app/pipelines/[id]/_client.tsx", "utf8");

    expect(page).toContain('t("Não foi possível carregar este funil agora. Tente novamente.")');
    expect(page).toContain('t("Tentar novamente")');
    expect(page).toContain("void refetch()");
    expect(page).not.toContain("formatError(error");
  });
});
