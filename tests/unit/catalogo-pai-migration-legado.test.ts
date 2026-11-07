// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const raiz = process.cwd();

function ler(caminho: string) {
  return readFileSync(resolve(raiz, caminho), "utf8");
}

describe("migração 0300 e linhas legadas do painel", () => {
  it.each([
    "supabase/migrations/20261104140000_0300_catalogo_pai_e_galeria.sql",
    "supabase/baseline.sql",
  ])("não inventa o SKU pai a partir do código vendável em %s", (caminho) => {
    const sql = ler(caminho);

    expect(sql).not.toMatch(/set\s+produto_codigo\s*=\s*codigo/i);
    expect(sql).not.toMatch(
      /insert\s+into\s+public\.catalog_product_groups[\s\S]{0,800}?from\s+public\.catalog_products\s+where\s+origem\s*=\s*'painel'/i,
    );
  });
});
