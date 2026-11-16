import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regressão de responsividade (celular ~360px): formulários das telas
 * principais (Kanban, relatório, perfil, tarefas) não podem ter grade de 2+
 * colunas incondicional — em tela estreita os campos estouram/espremem.
 * Vale para qualquer organização: é layout, sem dado de org.
 */
const TELAS = [
  "components/kanban/EditLeadDialog.tsx",
  "components/kanban/LeadFieldsForm.tsx",
  "components/kanban/NewLeadDialog.tsx",
  "app/app/relatorio/_components/CostThresholds.tsx",
  "app/app/relatorio/_components/TrafficDashboard.tsx",
  "app/app/settings/profile/_form.tsx",
  "app/app/tasks/_components/FormularioDeTarefa.tsx",
];

/** token `grid-cols-N` (N>=2) sem prefixo de breakpoint (sm:, md:, ...). */
const INCONDICIONAL = /(?<![\w:-])grid-cols-[2-9]\b/;

describe("layout responsivo das telas principais", () => {
  for (const arquivo of TELAS) {
    it(`${arquivo} não usa grid-cols-2+ sem breakpoint`, () => {
      const src = readFileSync(join(process.cwd(), arquivo), "utf8");
      const ruins = src.split("\n").filter((l) => INCONDICIONAL.test(l));
      expect(ruins).toEqual([]);
    });
  }

  it("o detector pega a regressão", () => {
    expect(INCONDICIONAL.test('className="grid grid-cols-2 gap-3"')).toBe(true);
    expect(INCONDICIONAL.test('className="grid grid-cols-1 sm:grid-cols-2"')).toBe(false);
  });

  it("tabelas do relatório rolam na horizontal em vez de estourar a página", () => {
    for (const f of [
      "app/app/relatorio/_components/RichReportSections.tsx",
      "app/app/relatorio/_components/TrafficDashboard.tsx",
    ]) {
      const src = readFileSync(join(process.cwd(), f), "utf8");
      const tabelas = src.match(/<table\b/g)?.length ?? 0;
      const rolagens = src.match(/overflow-(x-)?auto/g)?.length ?? 0;
      expect(rolagens).toBeGreaterThanOrEqual(tabelas);
    }
  });
});
