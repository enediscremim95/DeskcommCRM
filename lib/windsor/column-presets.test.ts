import { describe, expect, it } from "vitest";

import { serializeTrafficColumnPresets } from "./column-presets";

describe("predefinições de colunas do Relatório", () => {
  it("preserva a ordem e identifica o padrão", () => {
    expect(
      serializeTrafficColumnPresets(
        [
          {
            id: "preset-1",
            name: "KPI",
            metric_columns: ["leads", "spend", "ctr"],
          },
        ],
        "preset-1",
      ),
    ).toEqual([
      {
        id: "preset-1",
        name: "KPI",
        columns: ["leads", "spend", "ctr"],
        is_default: true,
      },
    ]);
  });

  it("não entrega ao browser uma linha legada inválida", () => {
    expect(
      serializeTrafficColumnPresets(
        [{ id: "preset-1", name: "Inválida", metric_columns: ["spend", "desconhecida"] }],
        null,
      ),
    ).toEqual([]);
  });
});
