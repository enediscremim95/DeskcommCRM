import { execFileSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SCRIPT = path.join(process.cwd(), "tests/fixtures/pacing-janela-invalida.ts");

function executar(helper: "nextWindowOpen" | "nextDayOpen"): string {
  return execFileSync(process.execPath, ["--import", "tsx", SCRIPT, helper], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 1_000,
  }).trim();
}

describe("pacing com janela inválida", () => {
  it("nextWindowOpen termina e devolve o primeiro candidato futuro", () => {
    expect(executar("nextWindowOpen")).toBe("2026-11-04T10:00:00.000Z");
  });

  it("nextDayOpen termina e devolve o primeiro candidato futuro", () => {
    expect(executar("nextDayOpen")).toBe("2026-11-04T10:00:00.000Z");
  });
});
