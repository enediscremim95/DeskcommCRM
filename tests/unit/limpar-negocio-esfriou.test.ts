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
    expect(texto).toContain("\\gexec");
    expect(texto).toContain("LIMIT 500");
    expect(texto).toContain("contagem ANTES");
    expect(texto).toContain("contagem DEPOIS");
    expect(texto).toContain("SET statement_timeout = '30s'");
    expect(texto).not.toMatch(/SET statement_timeout = 0\b/);
    expect(texto).toContain("mantidas_pelo_intervalo");
    expect(texto).toContain("intervalo_esfriamento '6 hours'");
    expect(texto).toContain("SET lock_timeout = '30s'");
    expect(texto).toContain("ORDER BY id");
    const derrubar = texto.indexOf(
      "DROP INDEX CONCURRENTLY IF EXISTS public.ops_tmp_messages_activity_id",
    );
    const criar = texto.indexOf("CREATE INDEX CONCURRENTLY ops_tmp_messages_activity_id");
    expect(derrubar).toBeGreaterThan(-1);
    expect(criar).toBeGreaterThan(derrubar);
  });

  it("encerra o episódio com os mesmos tipos que o worker", () => {
    const bloco = texto.split("-- BEGIN IDENTIFICACAO")[1]?.split("-- END IDENTIFICACAO")[0] ?? "";
    expect(bloco).not.toBe("");
    expect(bloco).toContain("ORDER BY performed_at, id");
    expect(bloco).toContain(":'intervalo_esfriamento'::interval");
    expect(bloco).not.toContain("created_at");
    const lista = bloco.match(/type IN \(\s*([^)]+)\)/)?.[1] ?? "";
    const citados = [...lista.matchAll(/'([a-z_]+)'/g)].map((achado) => achado[1]!);
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
