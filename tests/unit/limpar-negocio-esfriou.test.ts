import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { TIPOS_QUE_ENCERRAM_ESFRIAMENTO } from "@/lib/leads/risk-worker";

const RAIZ = join(__dirname, "..", "..");
const SCRIPT = join(RAIZ, "scripts/ops/limpar-negocio-esfriou-repetido.sql");

describe("script manual de Negócio esfriou repetido", () => {
  const texto = readFileSync(SCRIPT, "utf8");

  it("exige cópia da tabela e só apaga lead_cooled, em lotes", () => {
    expect(texto).toContain("pg_dump");
    expect(texto).toContain("--table=public.crm_lead_activities");
    expect(texto).toContain("AND a.type = 'lead_cooled'");
    expect(texto).toContain("CALL pg_temp.limpar_negocio_esfriou_repetido(500)");
    expect(texto).toContain("contagem ANTES");
    expect(texto).toContain("contagem DEPOIS");
  });

  it("encerra o episódio com os mesmos tipos que o worker", () => {
    const bloco = texto.split("-- BEGIN IDENTIFICACAO")[1]?.split("-- END IDENTIFICACAO")[0] ?? "";
    expect(bloco).not.toBe("");
    const citados = [...bloco.matchAll(/'([a-z_]+)'/g)].map((achado) => achado[1]!);
    const encerram = citados.filter((tipo) => tipo !== "lead_cooled");
    expect(encerram.sort()).toEqual([...TIPOS_QUE_ENCERRAM_ESFRIAMENTO].sort());
  });

  it("não entra no schema que o instalador aplica sozinho", () => {
    const nome = "limpar-negocio-esfriou-repetido";
    const arquivos = [
      "supabase/baseline.sql",
      "supabase/migrations/MANIFEST.md",
      "hostgator-setup-kit/install.sh",
      "hostgator-setup-kit/update.sh",
      "scripts/test-db.sh",
    ];
    for (const relativo of arquivos) {
      expect(readFileSync(join(RAIZ, relativo), "utf8"), relativo).not.toContain(nome);
    }
    const migrations = readdirSync(join(RAIZ, "supabase/migrations")).filter((arquivo) =>
      arquivo.endsWith(".sql"),
    );
    expect(migrations.some((arquivo) => arquivo.includes(nome))).toBe(false);
  });
});
