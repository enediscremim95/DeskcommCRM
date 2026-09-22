import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(path, "utf8");
}

describe("pacote RD no quadro e na ficha do lead", () => {
  it("mantém situação, estrelas, resumo e tarefa no card", () => {
    const card = source("components/kanban/KanbanCard.tsx");
    const actions = source("components/kanban/KanbanCardActions.tsx");
    expect(card).toContain('t("Em andamento")');
    expect(card).toContain("<LeadQualification");
    expect(card).toContain("onSummary?.(lead.id)");
    expect(actions).toContain('t("Criar tarefa")');
  });

  it("expõe o resumo solicitado e o caminho para abrir o lead", () => {
    const dossier = source("components/kanban/LeadDossier.tsx");
    for (const label of [
      "Origem",
      "Campanha",
      "Interações",
      "Última anotação",
      "Na etapa desde",
      "Último contato",
      "Previsão de fechamento",
      "Responsável",
      "Abrir lead",
    ]) {
      expect(dossier).toContain(`t("${label}")`);
    }
  });

  it("coloca próximas tarefas, datas, estrelas e retomada na ficha", () => {
    const page = source("components/leads/LeadPageClient.tsx");
    expect(page).toContain("<ProximasTarefasDoLead");
    expect(page).toContain("<LeadQualification");
    expect(page).toContain('t("Retomar negociação")');
    expect(page).toContain("stageAgeTooltip(leadAtual.stage_entered_at)");
    expect(page).toContain("stageAgeTooltip(leadAtual.created_at)");
  });

  it("leva a qualificação para migration, baseline e manifest", () => {
    expect(
      source("supabase/migrations/20260922143000_0256_qualificacao_humana_lead.sql"),
    ).toContain("qualification between 1 and 5");
    expect(source("supabase/baseline.sql")).toContain("migration 0256");
    expect(source("supabase/migrations/MANIFEST.md")).toContain("0256");
  });
});
