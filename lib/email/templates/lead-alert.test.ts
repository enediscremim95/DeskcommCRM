import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/branding/saida", () => ({
  NEUTROS_DE_SAIDA: { fundo: "#ffffff", texto: "#111111", suave: "#666666" },
}));

import { buildLeadAlertEmail, buildLeadBatchEmail, buildUrgentLeadBatchEmail } from "./lead-alert";

const marca = {
  nome: "Marca <Segura>",
  logoUrl: "https://cdn.example/logo?a=1&b=2",
  accent: "#123456",
  accentFg: "#ffffff",
  origens: { nome: "organizacao", cor: "organizacao" },
};

describe("buildLeadAlertEmail", () => {
  it("mantém dados do lead fora do aviso e leva à ficha autenticada", () => {
    const result = buildLeadAlertEmail({
      kind: "new_lead",
      href: "https://crm.example/app/leads/lead-1?a=1&b=2",
      marca,
      organizationName: "Bendito Ponto",
      leadTitle: "Jatobá Eliana",
    });

    expect(result.subject).toBe("Novo lead na Bendito Ponto: Jatobá Eliana | Marca <Segura>");
    expect(result.text).toContain("https://crm.example/app/leads/lead-1?a=1&b=2");
    expect(result.html).toContain("Marca &lt;Segura&gt;");
    expect(result.html).toContain("a=1&amp;b=2");
    expect(result.html).toContain("Telefone, e-mail, mensagens e demais dados");
  });

  it("distingue risco do Radar de tarefa vencida sem expor conteúdo do lead", () => {
    const radar = buildLeadAlertEmail({
      kind: "urgent_lead",
      urgentReason: "risk",
      href: "https://crm.example/app/leads/lead-1",
      marca,
      organizationName: "Bendito Ponto",
      leadTitle: "Jatobá Eliana",
    });
    const task = buildLeadAlertEmail({
      kind: "urgent_lead",
      urgentReason: "task_overdue",
      href: "https://crm.example/app/leads/lead-1",
      marca,
      organizationName: "Bendito Ponto",
      leadTitle: "Jatobá Eliana",
    });

    expect(radar.text).toContain("O Radar identificou");
    expect(task.text).toContain("tarefa vencida");
    expect(radar.text).toContain("Telefone, e-mail, mensagens e demais dados");
    expect(radar.subject).toContain("Ação urgente na Bendito Ponto: Jatobá Eliana");
  });

  it("resume a rajada com organização e contagem, escapando os títulos", () => {
    const result = buildLeadBatchEmail({
      marca,
      organizationName: "Bendito & Ponto",
      items: [
        { title: "Lead <Um>", href: "https://crm.example/app/leads/1?a=1&b=2" },
        { title: "Lead Dois", href: "https://crm.example/app/leads/2" },
      ],
    });

    expect(result.subject).toBe("2 leads novos na Bendito & Ponto | Marca <Segura>");
    expect(result.html).toContain("2 leads novos na Bendito &amp; Ponto");
    expect(result.html).toContain("Lead &lt;Um&gt;");
    expect(result.html).toContain("a=1&amp;b=2");
    expect(result.text).toContain("Lead Dois: https://crm.example/app/leads/2");
  });

  it("resume urgências com etapa, motivo, tempo e botão para o funil", () => {
    const result = buildUrgentLeadBatchEmail({
      marca,
      organizationName: "Bendito & Ponto",
      funnelHref: "https://crm.example/app/kanban?a=1&b=2",
      deferredCount: 4,
      items: [
        {
          title: "Lead <Um>",
          stage: "Negociação",
          reason: "tarefa vencida",
          age: "há 3 h",
        },
      ],
    });

    expect(result.subject).toBe("1 lead pedindo ação na Bendito & Ponto | Marca <Segura>");
    expect(result.html).toContain("Lead &lt;Um&gt;");
    expect(result.html).toContain("Negociação · tarefa vencida · há 3 h");
    expect(result.html).toContain("https://crm.example/app/kanban?a=1&amp;b=2");
    expect(result.text).toContain("4 leads adiados pelo teto diário");
  });
});
