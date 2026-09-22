import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = readFileSync(
  join(root, "supabase/migrations/20260922170000_0258_colunas_relatorio_por_plataforma.sql"),
  "utf8",
);
const baseline = readFileSync(join(root, "supabase/baseline.sql"), "utf8");
const manifest = readFileSync(join(root, "supabase/migrations/MANIFEST.md"), "utf8");

describe("migration 0258, colunas do Relatório por plataforma", () => {
  it("sai na tripla que chega ao self-host", () => {
    expect(migration).toContain("add column if not exists platform text");
    expect(baseline).toContain("Colunas do Relatório por plataforma (migration 0258)");
    expect(manifest).toContain("0258_colunas_relatorio_por_plataforma");
  });

  it("duplica as predefinições antigas para Google sem duplicar na reaplicação", () => {
    for (const sql of [migration, baseline]) {
      expect(sql).toContain("source.platform = 'meta_ads'");
      expect(sql).toContain("existing.platform = 'google_ads'");
      expect(sql).toContain("not exists (");
      expect(sql).toContain("'reach'");
      expect(sql).toContain("'messaging_conversations'");
      expect(sql).toContain("'cost_per_messaging_conversation'");
    }
  });

  it("mantém padrões independentes para Meta e Google", () => {
    for (const sql of [migration, baseline]) {
      expect(sql).toContain("default_meta_column_preset_id");
      expect(sql).toContain("default_google_column_preset_id");
      expect(sql).toContain("traffic_dashboard_column_presets_org_platform_name_uk");
    }
  });
});
