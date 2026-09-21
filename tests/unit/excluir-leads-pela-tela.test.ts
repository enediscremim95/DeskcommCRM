import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("exclusão de leads pela tela", () => {
  const dialogo = readFileSync("components/leads/DeleteLeadDialog.tsx", "utf8");
  const card = readFileSync("components/kanban/KanbanCardActions.tsx", "utf8");
  const lote = readFileSync("components/kanban/BulkActionBar.tsx", "utf8");
  const ficha = readFileSync("components/leads/LeadPageClient.tsx", "utf8");
  const paginaDoFunil = readFileSync("app/app/pipelines/[id]/_client.tsx", "utf8");
  const hook = readFileSync("hooks/kanban/useBulkAction.ts", "utf8");

  it("usa a única rota em lote nos três pontos de entrada", () => {
    expect(dialogo).toContain('action: "delete"');
    expect(dialogo).toContain("lead_ids: leadIds");
    expect(card).toContain("<DeleteLeadDialog");
    expect(lote).toContain("<DeleteLeadDialog");
    expect(ficha).toContain("<DeleteLeadDialog");
  });

  it("protege as ações visuais com o piso manager+ de exclusão", () => {
    expect(card).toContain('usePermission("resource.delete")');
    expect(card).toMatch(/\{canDelete && \([\s\S]*setDeleteOpen\(true\)/);
    expect(lote).toContain('const podeExcluir = usePermission("resource.delete")');
    expect(lote).toMatch(/\{podeExcluir && \([\s\S]*setConfirmDelete\(true\)/);
    expect(ficha).toContain('usePermission("resource.delete")');
  });

  it("nomeia o lead e avisa que a exclusão é irreversível", () => {
    expect(dialogo).toContain("leadTitle");
    expect(dialogo).toContain("não pode ser desfeita");
  });

  it("remove os cards do cache do quadro para atualizar cartões, contagens e somas", () => {
    expect(hook).toContain('input.action !== "delete"');
    expect(hook).toContain("qc.setQueryData<BoardData>");
    expect(hook).toContain("atual.leads.filter");
    expect(paginaDoFunil).toContain("selectedIdsVisiveis");
    expect(paginaDoFunil).toContain("existentes.has(id)");
  });

  it("volta ao funil depois de excluir pela ficha", () => {
    expect(ficha).toContain("router.replace(`/app/pipelines/${lead.pipeline_id}`)");
  });
});
