import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = readFileSync(join(root, "supabase/migrations/20260918210000_0248_integracoes_por_organizacao.sql"), "utf8");
const baseline = readFileSync(join(root, "supabase/baseline.sql"), "utf8");
const manifest = readFileSync(join(root, "supabase/migrations/MANIFEST.md"), "utf8");

describe("tripla das integrações por organização", () => {
  it("mantém migration, baseline e manifesto juntos", () => {
    for (const source of [migration, baseline]) {
      expect(source).toContain("organization_integration_permissions");
      expect(source).toContain("n8n_workflow_bindings");
      expect(source).toContain("enable row level security");
      expect(source).toContain("fn_configure_organization_integrations");
      expect(source).toContain("from public, anon, authenticated");
    }
    expect(manifest).toContain("0248_integracoes_por_organizacao");
    expect(baseline.indexOf("integrações por organização (migration 0248)"))
      .toBeLessThan(baseline.indexOf("VARREDURA anon: bloco final auto-curativo"));
  });
});
