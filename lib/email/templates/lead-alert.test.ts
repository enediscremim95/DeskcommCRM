import { describe, expect, it } from "vitest";

import { buildLeadAlertEmail } from "./lead-alert";

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
    });

    expect(result.subject).toBe("Novo lead aguardando atendimento | Marca <Segura>");
    expect(result.text).toContain("https://crm.example/app/leads/lead-1?a=1&b=2");
    expect(result.html).toContain("Marca &lt;Segura&gt;");
    expect(result.html).toContain("a=1&amp;b=2");
    expect(result.html).toContain("os dados do lead não aparecem neste e-mail");
  });

  it("distingue risco do Radar de tarefa vencida sem expor conteúdo do lead", () => {
    const radar = buildLeadAlertEmail({
      kind: "urgent_lead",
      urgentReason: "risk",
      href: "https://crm.example/app/leads/lead-1",
      marca,
    });
    const task = buildLeadAlertEmail({
      kind: "urgent_lead",
      urgentReason: "task_overdue",
      href: "https://crm.example/app/leads/lead-1",
      marca,
    });

    expect(radar.text).toContain("O Radar identificou");
    expect(task.text).toContain("tarefa vencida");
    expect(radar.text).toContain("Os dados do lead ficam somente no sistema.");
  });
});
