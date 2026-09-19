import { describe, expect, it } from "vitest";

import { reorderColumns } from "./ColumnPresetMenu";

describe("ordem das colunas de uma predefinição", () => {
  it("move a coluna sem reordenar as demais", () => {
    expect(reorderColumns(["spend", "leads", "cpm", "ctr"], 3, 1)).toEqual([
      "spend",
      "ctr",
      "leads",
      "cpm",
    ]);
  });

  it("ignora um destino fora da lista", () => {
    const columns = ["spend", "leads"] as const;
    expect(reorderColumns([...columns], 0, 8)).toEqual(columns);
  });
});
