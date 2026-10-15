import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("contrato multi-tenant do relatório em slides", () => {
  it("reutiliza a rota canônica autenticada e busca o slug só pelo tenant resolvido", () => {
    const root = process.cwd();
    const canonical = readFileSync(join(root, "app/api/v1/reports/traffic/route.ts"), "utf8");
    const slides = readFileSync(
      join(root, "app/api/v1/reports/traffic/slides/route.ts"),
      "utf8",
    );

    expect(canonical).toContain('requireRole("viewer",');
    expect(canonical).toContain('.eq("organization_id", organizationId)');
    expect(slides).toContain("getTrafficReport(");
    expect(slides).toContain("{ headers: request.headers }");
    expect(slides).toContain('.eq("id", envelope.data.organization_key)');
    expect(slides).not.toMatch(/searchParams\.get\(["']organization/i);
    expect(slides).not.toMatch(/organization(?:_id|Id)\s*:\s*params\./);
  });
});
