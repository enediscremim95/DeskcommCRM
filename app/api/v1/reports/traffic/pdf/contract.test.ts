import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("contrato de autorização e isolamento do PDF", () => {
  it("delega os dados à rota canônica, protegida por viewer e filtro de organização", () => {
    const canonical = readFileSync(
      join(process.cwd(), "app/api/v1/reports/traffic/route.ts"),
      "utf8",
    );
    const pdf = readFileSync(
      join(process.cwd(), "app/api/v1/reports/traffic/pdf/route.ts"),
      "utf8",
    );

    expect(canonical).toContain('requireRole("viewer"');
    expect(canonical).toContain('.eq("organization_id", organizationId)');
    expect(pdf).toContain("getTrafficReport(request)");
    expect(pdf).not.toContain("organization_id=");
  });
});
