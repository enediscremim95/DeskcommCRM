import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = readFileSync(
  join(root, "supabase/migrations/20260919050000_0250_predefinicoes_colunas_relatorio.sql"),
  "utf8",
);
const baseline = readFileSync(join(root, "supabase/baseline.sql"), "utf8");
const manifest = readFileSync(join(root, "supabase/migrations/MANIFEST.md"), "utf8");

describe("migration 0250, predefinições de colunas", () => {
  it("sai na tripla que chega ao self-host", () => {
    expect(migration).toContain(
      "create table if not exists public.traffic_dashboard_column_presets",
    );
    expect(baseline).toContain("Predefinições de colunas do Relatório (migration 0250)");
    expect(manifest).toContain("0250_predefinicoes_colunas_relatorio");
  });

  it("isola por organização e impede padrão cross-tenant", () => {
    for (const sql of [migration, baseline]) {
      expect(sql).toContain("tenant_isolation_traffic_dashboard_column_presets_all");
      expect(sql).toContain("organization_id in (select public.fn_user_org_ids())");
      expect(sql).toContain("foreign key (organization_id, default_column_preset_id)");
      expect(sql).toContain("on delete set null (default_column_preset_id)");
    }
  });

  it("mantém a escrita direta fechada para authenticated", () => {
    for (const sql of [migration, baseline]) {
      expect(sql).toContain(
        "revoke all on public.traffic_dashboard_column_presets from anon, authenticated",
      );
      expect(sql).toContain(
        "grant select on public.traffic_dashboard_column_presets to authenticated",
      );
    }
  });
});
