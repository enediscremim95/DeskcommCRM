import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = readFileSync(
  join(root, "supabase/migrations/20260922163000_0257_metricas_prioritarias_relatorio.sql"),
  "utf8",
);
const baseline = readFileSync(join(root, "supabase/baseline.sql"), "utf8");
const manifest = readFileSync(join(root, "supabase/migrations/MANIFEST.md"), "utf8");

describe("migration 0257, métricas prioritárias do relatório", () => {
  it("sai na tripla do self-host com apêndice idempotente", () => {
    const statement = "add column if not exists priority_metric_columns text[]";
    expect(migration).toContain(statement);
    expect(baseline).toContain("Métricas prioritárias do Relatório (migration 0257)");
    expect(baseline).toContain(statement);
    expect(manifest).toContain("0257_metricas_prioritarias_relatorio");
  });

  it("mantém null sem default para preservar o padrão do modelo", () => {
    expect(migration).not.toMatch(/priority_metric_columns text\[\]\s+not null/i);
    expect(migration).not.toMatch(/priority_metric_columns text\[\][^;]*default/i);
  });
});
