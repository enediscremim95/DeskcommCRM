// @vitest-environment node

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";

import { renderTrafficSummaryPdf } from "./traffic-summary-pdf";

describe("PDF do relatório enriquecido", () => {
  it("renderiza variações, destaques, situação dos leads e leitura do funil sem nota explicativa", async () => {
    const buffer = await renderTrafficSummaryPdf({
      brand: {
        nome: "Marca Exemplo",
        logoUrl: null,
        accent: "#506d48",
        accentFg: "#ffffff",
        origens: { nome: "organizacao", cor: "organizacao" },
      },
      language: "pt-BR",
      source: {
        window: { from: "2026-08-22", to: "2026-09-20" },
        crm: {
          leads_entered: 42,
          in_service: 20,
          closed_won: 12,
          closed_lost: 10,
          stages: [
            { name: "Novo contato", count: 8 },
            { name: "Em atendimento", count: 12 },
            { name: "Venda ganha", count: 12 },
            { name: "Perdido", count: 10 },
          ],
          loss_reasons: [{ reason: "Sem orçamento", count: 10 }],
          previous: {
            leads_entered: 35,
            in_service: 19,
            closed_won: 8,
            closed_lost: 8,
          },
        },
        currencies: [
          {
            currency: "BRL",
            summary: { spend: 3_150, reach: 48_200, impressions: 76_100, clicks: 1_860 },
            comparison: { spend: 2_975, reach: 44_100, impressions: 70_200, clicks: 1_590 },
            campaigns: [
              {
                name: "Captação principal",
                leads: 42,
                cost_per_lead: 75,
                conversion_rate: 12.5,
              },
              {
                name: "Remarketing",
                leads: 18,
                cost_per_lead: 60,
                conversion_rate: 15,
              },
            ],
          },
        ],
        delivery: {
          active_campaigns: [{ name: "Captação principal", platform: "meta_ads" }],
          invested_campaigns: [],
          pages: ["cliente.exemplo/consulta"],
        },
      },
    });

    const document = await getDocument({ data: new Uint8Array(buffer) }).promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
    }
    const text = pages.join(" ");

    expect(text).toContain("+20% vs. período anterior");
    expect(text).toContain("MAIS LEADS");
    expect(text).toContain("MENOR CUSTO POR LEAD");
    expect(text).toContain("MELHOR CONVERSÃO");
    expect(text).toContain("Captação principal");
    expect(text).toContain("R$ 75,00");
    expect(text).toContain("12,5%");
    expect(text).toContain("Destaques do período");
    expect(text).toContain("Situação dos leads");
    expect(text).toContain("Sem orçamento: 10");
    expect(text).toContain("Leitura do funil");
    expect(text).toContain("O que está rodando");
    expect(text.toLocaleLowerCase("pt-BR")).not.toContain("metodologia");
    expect(text.toLocaleLowerCase("pt-BR")).not.toContain("nota explicativa");
  });
});
