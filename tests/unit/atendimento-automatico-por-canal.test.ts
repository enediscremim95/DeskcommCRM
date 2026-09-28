import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { crmSetChannelAutomaticAttendance } from "@/lib/mcp/tools/channels";

const migration = readFileSync(
  "supabase/migrations/20260928120000_0274_atendimento_automatico_por_canal.sql",
  "utf8",
);
const baseline = readFileSync("supabase/baseline.sql", "utf8");
const manifest = readFileSync("supabase/migrations/MANIFEST.md", "utf8");

describe("atendimento automático por canal", () => {
  it("mantém a migration tripla e faz canal novo nascer desligado", () => {
    for (const sql of [migration, baseline]) {
      expect(sql).toContain("automatic_attendance_enabled");
      expect(sql).toMatch(/automatic_attendance_enabled set default false/);
      expect(sql).toMatch(/automatic_attendance_enabled set not null/);
    }
    expect(manifest).toContain("0274_atendimento_automatico_por_canal");
  });

  it("preserva canais existentes ligados somente quando a coluna nasce", () => {
    for (const sql of [migration, baseline]) {
      const column = sql.lastIndexOf("column_name = 'automatic_attendance_enabled'");
      const guard = sql.lastIndexOf("if not exists", column);
      const backfill = sql.indexOf("set automatic_attendance_enabled = true", column);
      const endGuard = sql.indexOf("end if;", backfill);
      expect(guard).toBeGreaterThanOrEqual(0);
      expect(backfill).toBeGreaterThan(guard);
      expect(backfill).toBeLessThan(endGuard);
    }
  });

  it("expõe a escrita MCP somente a gerente com escopo de escrita e explica o risco", () => {
    expect(crmSetChannelAutomaticAttendance.requiresRole).toBe("manager");
    expect(crmSetChannelAutomaticAttendance.requiresScope).toBe("mcp:write");
    expect(crmSetChannelAutomaticAttendance.description).toContain("nenhuma resposta automática é enviada");
    expect(crmSetChannelAutomaticAttendance.description).toContain("Canais novos começam desligados");
  });
});
