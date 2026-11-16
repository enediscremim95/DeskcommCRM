import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
function job(nome: string): string {
  const start = workflow.indexOf(`  ${nome}:\n`);
  expect(start).toBeGreaterThan(0);
  const rest = workflow.slice(start + 2);
  const next = rest.search(/\n {2}[a-z][a-z_-]*:\n/);
  return next < 0 ? rest : rest.slice(0, next);
}
describe("CI particiona sem omitir unitários", () => {
  it("executa as duas partes nativas da suíte inteira, mesmo se uma reprovar", () => {
    const partes = job("unitarios");
    expect(partes).toMatch(/parte: \[1, 2\]/);
    expect(partes).toContain("fail-fast: false");
    expect(partes).toContain("pnpm test:unit --shard=${{ matrix.parte }}/2");
    const manifest = JSON.parse(readFileSync("package.json", "utf8"));
    expect(manifest.scripts["test:unit"]).toBe("vitest run");
  });
  it("verify não aceita falha, cancelamento ou skip das partes", () => {
    const gate = job("verify");
    expect(gate).toContain("needs: [unitarios]");
    expect(gate).toContain("if: always()");
    expect(gate).toContain('[ "${{ needs.unitarios.result }}" = "success" ]');
    for (const command of ["pnpm typecheck", "pnpm lint", "pnpm lint:channels", "pnpm test:shell"]) expect(gate).toContain(command);
  });
});
