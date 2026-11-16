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

describe("carga enxuta e alvos de toque nas telas principais", () => {
  const ler = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

  it("campos de texto usam 16px no celular (evita zoom automático do iOS no login e nas buscas)", () => {
    expect(ler("components/ui/input.tsx")).toMatch(/text-base md:text-sm/);
  });

  it("contatos: diálogos pesados são carregados sob demanda, não no bundle inicial", () => {
    const src = ler("app/app/contacts/_client.tsx");
    for (const d of ["NewContactDialog", "ImportContactsDialog", "MergeDialog"]) {
      expect(src).not.toMatch(new RegExp(`import \\{ ${d} \\} from`));
      expect(src).toMatch(new RegExp(`const ${d} = dynamic\\(`));
    }
  });

  it("relatório: painel nativo é import dinâmico e o iframe tem respiro menor no celular", () => {
    const src = ler("app/app/relatorio/_client.tsx");
    expect(src).not.toMatch(/import \{ TrafficDashboard \} from/);
    expect(src).toMatch(/const TrafficDashboard = dynamic\(/);
    expect(src).toMatch(/p-4 sm:p-6/);
  });

  it("conversas: a lista e o painel alternam no celular (uma coluna por vez) e só dividem a tela a partir de md", () => {
    const src = ler("components/inbox/InboxLayout.tsx");
    expect(src).toContain('lista: temSelecao ? "hidden md:flex" : "flex"');
    expect(src).toContain('conversa: temSelecao ? "flex" : "hidden md:flex"');
    expect(src).toMatch(/grid-cols-1 md:grid-cols-\[300px_1fr\]/);
  });
});
