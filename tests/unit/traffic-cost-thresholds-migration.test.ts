import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = readFileSync(
  join(root, "supabase/migrations/20260922010000_0254_limites_custo_relatorio.sql"),
  "utf8",
);
const baseline = readFileSync(join(root, "supabase/baseline.sql"), "utf8");
const manifest = readFileSync(join(root, "supabase/migrations/MANIFEST.md"), "utf8");

describe("migration 0254, limites de custo do relatório", () => {
  it("sai na tripla do self-host", () => {
    expect(migration).toContain("create table if not exists public.traffic_report_cost_thresholds");
    expect(baseline).toContain("Limites de custo do Relatório rico (migration 0254)");
    expect(manifest).toContain("0254_limites_custo_relatorio");
  });

  it("usa a política tenant-aware exigida e fecha escrita direta", () => {
    for (const sql of [migration, baseline]) {
      expect(sql).toContain("organization_id in (select public.fn_user_org_ids())");
      expect(sql).not.toContain("organization_id = any(public.fn_user_org_ids())");
      expect(sql).toContain(
        "revoke all on public.traffic_report_cost_thresholds from anon, authenticated",
      );
      expect(sql).toContain(
        "grant select on public.traffic_report_cost_thresholds to authenticated",
      );
    }
  });
});
