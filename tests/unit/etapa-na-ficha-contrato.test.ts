import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { moveLeadSchema } from "@/lib/schemas/leads";

describe("contrato da etapa na ficha", () => {
  it("aceita movimento sem posição e delega ao handler canônico", () => {
    expect(
      moveLeadSchema.safeParse({
        stage_id: "11111111-1111-4111-8111-111111111111",
        expected_updated_at: "2026-09-22T10:00:00.000Z",
      }).success,
    ).toBe(true);

    const route = readFileSync("app/api/v1/leads/[id]/move/route.ts", "utf8");
    const handler = readFileSync("app/api/v1/leads/_handler.ts", "utf8");
    expect(route).toContain("moveLeadHandler(");
    expect(route).toContain("position_in_stage: input.position_in_stage");
    expect(handler).toContain("Number(maxRow.position_in_stage) + 1000");
  });

  it("o banco atualiza stage_entered_at em qualquer mudança de stage_id", () => {
    const migration = readFileSync(
      "supabase/migrations/20260922100000_0255_stage_entered_at.sql",
      "utf8",
    );
    const baseline = readFileSync("supabase/baseline.sql", "utf8");
    const manifest = readFileSync("supabase/migrations/MANIFEST.md", "utf8");

    expect(migration).toContain("a.type = 'stage_changed'");
    expect(migration).toContain("new.stage_id is distinct from old.stage_id");
    expect(migration).toContain("new.stage_entered_at := now()");
    expect(baseline).toContain("Tempo na etapa do lead (migration 0255)");
    expect(manifest).toContain("0255_stage_entered_at");
  });

  it("viewer não arrasta card no kanban", () => {
    const board = readFileSync("components/kanban/KanbanBoard.tsx", "utf8");
    const card = readFileSync("components/kanban/KanbanCard.tsx", "utf8");
    expect(board).toContain('usePermission("pipeline.move_card")');
    expect(board).toContain("if (!podeMover || !data || !grouped) return");
    expect(card).toContain("isDragDisabled={!canMove}");
  });
});
