import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

function fontesDeCodigo(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? fontesDeCodigo(path) : /\.tsx?$/.test(path) ? [path] : [];
  });
}
describe("build com fontes distribuídas no produto", () => {
  it("nenhuma rota introduz dependência de Google Fonts na compilação", () => {
    expect(fontesDeCodigo("app").filter(path => /[\"']next\/font\/google[\"']/.test(readFileSync(path, "utf8")))).toEqual([]);
  });
  it("fontes locais são WOFF2 íntegros, com licença e origem fixada", () => {
    const manifest = JSON.parse(readFileSync("app/fonts/SOURCES.json", "utf8")) as {
      commit: string; files: Array<{ path: string; sha256?: string }>;
    };
    expect(manifest.commit).toMatch(/^[a-f0-9]{40}$/);
    const fontes = manifest.files.filter(row => row.path.endsWith(".woff2"));
    expect(fontes).toHaveLength(12);
    for (const row of fontes) {
      const data = readFileSync(row.path);
      expect(data.subarray(0, 4).toString(), row.path).toBe("wOF2");
      expect(createHash("sha256").update(data).digest("hex"), row.path).toBe(row.sha256);
      expect(readFileSync(join(dirname(row.path), "OFL.txt"), "utf8")).toContain("SIL OPEN FONT LICENSE");
    }
  });
});
