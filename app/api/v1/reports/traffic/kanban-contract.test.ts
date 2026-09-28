import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("etapas do Kanban no relatório", () => {
  const source = readFileSync(join(process.cwd(), "app/api/v1/reports/traffic/route.ts"), "utf8");

  it("lê etapas e leads pelo tenant autenticado e entrega as contagens ao cliente", () => {
    expect(source).toMatch(
      /from\("crm_stages" as never\)[\s\S]*?\.eq\("organization_id", organizationId\)[\s\S]*?\.eq\("is_archived", false\)/,
    );
    expect(source).toMatch(
      /from\("crm_leads" as never\)[\s\S]*?\.eq\("organization_id", organizationId\)/,
    );
    expect(source).toContain(
      "kanban_stages: buildTrafficKanbanStages(currentLeadRowsResult.data ?? [], stages)",
    );
  });
});
