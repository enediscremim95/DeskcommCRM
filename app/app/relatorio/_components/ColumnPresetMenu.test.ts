import { describe, expect, it } from "vitest";

import { columnPresetStorageKeys, reorderColumns } from "./ColumnPresetMenu";

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

  it("isola rascunho e predefinição local por plataforma", () => {
    const meta = columnPresetStorageKeys("org", "user", "leads", "meta_ads");
    const google = columnPresetStorageKeys("org", "user", "leads", "google_ads");

    expect(meta.columnsStorageKey).toBe("traffic-campaign-columns:org:user:leads:meta_ads");
    expect(google.columnsStorageKey).toBe("traffic-campaign-columns:org:user:leads:google_ads");
    expect(meta.presetStorageKey).not.toBe(google.presetStorageKey);
  });
});
