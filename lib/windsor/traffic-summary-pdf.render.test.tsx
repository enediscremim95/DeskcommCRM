// @vitest-environment node

import { renderToBuffer } from "@react-pdf/renderer";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";

import {
  buildTrafficAdsInTest,
  renderTrafficSummaryPdf,
  TrafficSummaryPdf,
} from "./traffic-summary-pdf";

describe("PDF do relatório enriquecido", () => {
  it("renderiza variações, pontos de melhoria e o que está rodando, sem nota explicativa", async () => {
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
                platform: "meta_ads",
                campaign_status: "ACTIVE",
                leads: 42,
                cost_per_lead: 75,
                conversion_rate: 12.5,
                adsets: [
                  {
                    name: "Conjunto principal",
                    ads: Array.from({ length: 13 }, (_, index) => ({
                      name: `Anúncio ${index + 1}`,
                      spend: 130 - index,
                      impressions: 1_000 - index,
                      leads: index + 1,
                      cost_per_lead: (130 - index) / (index + 1),
                      thumbnail_url: index === 0 ? "http://127.0.0.1/criativo.png" : null,
                      destination_urls:
                        index === 1
                          ? []
                          : [`https://cliente.exemplo/oferta-${index + 1}?utm_source=meta`],
                      first_delivery_on: index === 0 ? "2026-09-01" : "2026-08-01",
                      last_delivery_on: "2026-09-20",
                    })),
                  },
                ],
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
    // Enxugado a pedido do dono (21/09/2026): sem campeãs, destaques, situação e leitura.
    for (const removido of [
      "MAIS LEADS",
      "Destaques do período",
      "Situação dos leads",
      "Leitura do funil",
      "resumido de desempenho",
    ]) {
      expect(text).not.toContain(removido);
    }
    expect(text).toContain("Pontos de melhoria");
    expect(text).toContain("Conversão de clique em lead está em 2,3%");
    expect(text).toContain("Anúncios em teste");
    expect(text).toContain("O que está rodando");
    expect(text).toContain("Hoje: 1 campanha ativa");
    expect(text).toContain("1 página em teste");
    expect(text).toContain("Sem página informada");
    expect(text).toContain("Novo no período");
    expect(text).toContain("Anúncio 13");
    expect(text).not.toContain("e mais 1");
    expect(text.toLocaleLowerCase("pt-BR")).not.toContain("metodologia");
    expect(text.toLocaleLowerCase("pt-BR")).not.toContain("nota explicativa");
  });

  it("renderiza miniatura convertida e mantém o nome quando outra miniatura falta", async () => {
    const source = {
      window: { from: "2026-09-15", to: "2026-09-21" },
      crm: { leads_entered: 2, in_service: 1, closed_won: 1 },
      currencies: [
        {
          currency: "BRL",
          summary: { spend: 30, reach: 100, impressions: 200, clicks: 10 },
          campaigns: [
            {
              name: "Campanha",
              platform: "meta_ads" as const,
              campaign_status: "ACTIVE",
              leads: 2,
              cost_per_lead: 15,
              conversion_rate: 20,
              adsets: [
                {
                  name: "Conjunto",
                  ads: [
                    {
                      name: "Com miniatura",
                      spend: 20,
                      impressions: 120,
                      leads: 1,
                      cost_per_lead: 20,
                      thumbnail_url: "https://cdn.example/ok.png",
                      destination_urls: ["https://cliente.test/oferta"],
                      first_delivery_on: "2026-09-15",
                      last_delivery_on: "2026-09-21",
                    },
                    {
                      name: "Sem miniatura",
                      spend: 10,
                      impressions: 80,
                      leads: 1,
                      cost_per_lead: 10,
                      thumbnail_url: null,
                      destination_urls: [],
                      first_delivery_on: "2026-09-01",
                      last_delivery_on: "2026-09-21",
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const [first, second] = buildTrafficAdsInTest(source);
    const ads = [
      {
        ...first!,
        thumbnail_data_uri: [
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAE",
          "AAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        ].join(""),
      },
      { ...second!, thumbnail_data_uri: null },
    ];
    const buffer = await renderToBuffer(
      <TrafficSummaryPdf
        source={source}
        brand={{
          nome: "Marca Exemplo",
          logoUrl: null,
          accent: "#506d48",
          accentFg: "#ffffff",
          origens: { nome: "organizacao", cor: "organizacao" },
        }}
        language="pt-BR"
        adsInTest={ads}
      />,
    );

    expect(buffer.byteLength).toBeGreaterThan(0);
    const document = await getDocument({ data: new Uint8Array(buffer) }).promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
    }
    expect(pages.join(" ")).toContain("Com miniatura");
    expect(pages.join(" ")).toContain("Sem miniatura");
  });

  it("mantém o PDF quando o download da miniatura falha", async () => {
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
        window: { from: "2026-09-15", to: "2026-09-21" },
        crm: { leads_entered: 1, in_service: 1, closed_won: 0 },
        currencies: [
          {
            currency: "BRL",
            summary: { spend: 10, reach: 20, impressions: 30, clicks: 2 },
            campaigns: [
              {
                name: "Campanha",
                platform: "meta_ads",
                campaign_status: "ACTIVE",
                leads: 1,
                cost_per_lead: 10,
                conversion_rate: 50,
                adsets: [
                  {
                    name: "Conjunto",
                    ads: [
                      {
                        name: "Criativo preservado",
                        spend: 10,
                        impressions: 30,
                        leads: 1,
                        cost_per_lead: 10,
                        thumbnail_url: "https://cdn.example/falha.png",
                        destination_urls: ["https://cliente.test/oferta"],
                        first_delivery_on: "2026-09-15",
                        last_delivery_on: "2026-09-21",
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      thumbnailDependencies: {
        lookupFn: async () => [{ address: "8.8.8.8", family: 4 }],
        fetchFn: async () => {
          throw new Error("rede indisponível");
        },
      },
    });
    const document = await getDocument({ data: new Uint8Array(buffer) }).promise;
    const page = await document.getPage(document.numPages);
    const content = await page.getTextContent();
    const text = content.items.map((item) => ("str" in item ? item.str : "")).join(" ");

    expect(text).toContain("Criativo preservado");
  });

  it("explica quando o período não tem anúncio com entrega", async () => {
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
        window: { from: "2026-09-15", to: "2026-09-21" },
        crm: { leads_entered: 0, in_service: 0, closed_won: 0 },
        currencies: [],
      },
    });
    const document = await getDocument({ data: new Uint8Array(buffer) }).promise;
    const page = await document.getPage(document.numPages);
    const content = await page.getTextContent();
    const text = content.items.map((item) => ("str" in item ? item.str : "")).join(" ");

    expect(text).toContain("Nenhum anúncio com entrega neste período");
  });
});
