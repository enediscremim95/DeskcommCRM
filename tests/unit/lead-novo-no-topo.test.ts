import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("contrato de posição no funil", () => {
  it("usa reserva de topo na criação, no movimento sem posição e na reabertura", () => {
    const handler = readFileSync("app/api/v1/leads/_handler.ts", "utf8");
    const reabertura = readFileSync("lib/leads/reabertura.ts", "utf8");

    expect(handler.match(/lado: "topo"/g)).toHaveLength(2);
    expect(reabertura).toContain('lado: "topo"');
    expect(handler).not.toContain("maxRow.position_in_stage) + 1000");
    expect(reabertura).not.toContain("last.position_in_stage) + 1000");
  });

  it("mantém encerramentos no fim da coluna", () => {
    const encerramento = readFileSync("lib/leads/encerramento.ts", "utf8");

    expect(encerramento).toContain('lado: "fim"');
  });

  it("mantém o drag como autoridade da ordem manual", () => {
    const board = readFileSync("components/kanban/KanbanBoard.tsx", "utf8");
    const move = readFileSync("hooks/kanban/useMoveCard.ts", "utf8");

    expect(board).toContain("positionForPaginatedDrop(");
    expect(board).toContain("positionInStage: newPosition");
    expect(move).toContain("position_in_stage: args.positionInStage");
  });
});
