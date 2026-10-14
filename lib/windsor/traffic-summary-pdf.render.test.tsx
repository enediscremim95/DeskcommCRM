// @vitest-environment node

import { renderToBuffer } from "@react-pdf/renderer";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";

import {
  buildTrafficAdsInTest,
  renderTrafficSummaryPdf,
  TrafficSummaryPdf,
  type TrafficSummarySource,
} from "./traffic-summary-pdf";

const BRAND = {
  nome: "Marca Exemplo",
  logoUrl: null,
  accent: "#506d48",
  accentFg: "#ffffff",
  origens: { nome: "organizacao" as const, cor: "organizacao" as const },
};

const THUMBNAIL_DATA_URI = [
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAE",
  "AAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
].join("");

function sourceWithAds(adCount: number, platformCount = 1): TrafficSummarySource {
  return {
    organization_name: "Cliente de prova",
    window: { from: "2026-09-14", to: "2026-10-13" },
    crm: { leads_entered: 0, in_service: 0, closed_won: 0 },
    currencies: [{
      currency: "BRL",
      summary: { spend: 1_000, reach: 10_000, impressions: 12_000, clicks: 500, leads: 0 },
      platforms: [
        { platform: "meta_ads", spend: 700, reach: 8_000, impressions: 9_000, clicks: 400, leads: 0 },
        ...(platformCount >= 2 ? [{ platform: "google_ads" as const, spend: 300, reach: 2_000, impressions: 3_000, clicks: 100, leads: 0 }] : []),
      ],
      campaigns: adCount > 0 ? [{
        name: "Campanha de aquisição com um nome deliberadamente longo para ocupar no máximo duas linhas na tabela",
        platform: "meta_ads",
        campaign_status: "ACTIVE",
        leads: 0,
        cost_per_lead: null,
        conversion_rate: null,
        adsets: [{
          name: "Conjunto de prova",
          ads: Array.from({ length: adCount }, (_, index) => ({
            name: `LINHA-${String(index + 1).padStart(2, "0")} anúncio com nome longo que precisa ser truncado sem aumentar a altura`,
            spend: 100 - index,
            impressions: 1_000 - index,
            leads: 0,
            cost_per_lead: null,
            thumbnail_url: `https://cdn.example/criativo-${index + 1}.png`,
            destination_urls: [`https://cliente.example/oferta-com-endereco-longo-${index + 1}`],
            first_delivery_on: "2026-09-20",
            last_delivery_on: "2026-10-13",
          })),
        }],
      }] : [],
    }],
  };
}

async function renderFixture(source: TrafficSummarySource): Promise<Buffer> {
  const ads = buildTrafficAdsInTest(source).map((ad) => ({ ...ad, thumbnail_data_uri: THUMBNAIL_DATA_URI }));
  return (await renderToBuffer(
    <TrafficSummaryPdf source={source} brand={BRAND} language="pt-BR" adsInTest={ads} />,
  )) as Buffer;
}

async function extractPageTexts(buffer: Buffer): Promise<string[]> {
  const document = await getDocument({ data: new Uint8Array(buffer) }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
  }
  return pages;
}

describe("PDF do relatório enriquecido", () => {
  it("omite a página repetida com uma plataforma e mantém as duas páginas com duas", async () => {
    const onePlatformPages = await extractPageTexts(await renderFixture(sourceWithAds(0, 1)));
    const twoPlatformPages = await extractPageTexts(await renderFixture(sourceWithAds(0, 2)));

    expect(onePlatformPages.some((page) => page.trimStart().startsWith("Meta Ads "))).toBe(false);
    expect(twoPlatformPages.some((page) => page.trimStart().startsWith("Meta Ads "))).toBe(true);
    expect(twoPlatformPages.some((page) => page.trimStart().startsWith("Google Ads "))).toBe(true);
    expect(onePlatformPages.some((page) => page.includes("Resultados / Todas as mídias"))).toBe(true);
  });

  it("pagina 17 e 3 anúncios sem página vazia, linha partida ou linha repetida", async () => {
    for (const [adCount, expectedPages] of [[17, 3], [3, 1]] as const) {
      const pages = await extractPageTexts(await renderFixture(sourceWithAds(adCount)));
      const adsPages = pages.filter((page) => page.includes("Anúncios em teste"));

      expect(adsPages).toHaveLength(expectedPages);
      adsPages.forEach((page, index) => {
        expect(page).toContain(`Página ${index + 1} de ${expectedPages}`);
        expect(page).toContain("CRIATIVO");
        expect(page).toMatch(/LINHA-\d{2}/);
      });
      for (let index = 1; index <= adCount; index += 1) {
        const marker = `LINHA-${String(index).padStart(2, "0")}`;
        expect(adsPages.join(" ").split(marker)).toHaveLength(2);
      }
    }
  });

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
        organization_name: "Bendito Ponto",
        model: "leads",
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
            summary: {
              spend: 3_150,
              reach: 48_200,
              impressions: 76_100,
              clicks: 1_860,
              link_clicks: 1_730,
              leads: 42,
              cost_per_lead: 75,
              ctr: 2.27,
              conversion_rate: 2.43,
            },
            comparison: {
              spend: 2_975,
              reach: 44_100,
              impressions: 70_200,
              clicks: 1_590,
              link_clicks: 1_480,
              leads: 35,
              cost_per_lead: 85,
              ctr: 2.11,
              conversion_rate: 2.36,
            },
            platforms: [
              {
                platform: "meta_ads",
                spend: 1_761.48,
                reach: 38_200,
                impressions: 55_000,
                clicks: 1_100,
                link_clicks: 1_020,
                leads: 30,
                cost_per_lead: 58.72,
                ctr: 1.85,
                conversion_rate: 2.94,
                comparison: {
                  spend: 1_600,
                  reach: 35_000,
                  impressions: 50_000,
                  clicks: 900,
                  link_clicks: 840,
                  leads: 24,
                  cost_per_lead: 66.67,
                  ctr: 1.68,
                  conversion_rate: 2.86,
                },
              },
              {
                platform: "google_ads",
                spend: 1_388.52,
                reach: 10_000,
                impressions: 21_100,
                clicks: 760,
                link_clicks: 710,
                leads: 12,
                cost_per_lead: 115.71,
                ctr: 3.6,
                conversion_rate: 1.58,
                comparison: {
                  spend: 1_375,
                  reach: 9_100,
                  impressions: 20_200,
                  clicks: 690,
                  link_clicks: 640,
                  leads: 11,
                  cost_per_lead: 125,
                  ctr: 3.42,
                  conversion_rate: 1.59,
                },
              },
            ],
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
        historico: [
          {
            currency: "BRL",
            periods: [
              { from: "2026-04-22", to: "2026-05-21", spend: 2_100, leads: 25, cost_per_lead: 84 },
              { from: "2026-05-22", to: "2026-06-20", spend: 2_350, leads: 28, cost_per_lead: 83.93 },
              { from: "2026-06-21", to: "2026-07-20", spend: null, leads: null, cost_per_lead: null },
              { from: "2026-07-21", to: "2026-08-19", spend: 2_700, leads: 32, cost_per_lead: 84.38 },
              { from: "2026-08-20", to: "2026-09-18", spend: 2_975, leads: 35, cost_per_lead: 85 },
              { from: "2026-08-22", to: "2026-09-20", spend: 3_150, leads: 42, cost_per_lead: 75 },
            ],
          },
        ],
        lead_profile: {
          considered_leads: 39,
          fields: [
            { key: "faixa", label: "Faixa de investimento", answered: 39, coverage_percent: 100, top_value: "R$ 229 mil a R$ 299 mil", top_count: 28, top_percent: 71.8 },
            { key: "estado", label: "Estado", answered: 39, coverage_percent: 100, top_value: "SP", top_count: 10, top_percent: 25.6 },
            { key: "primeiro_negocio", label: "Primeiro negócio", answered: 37, coverage_percent: 94.9, top_value: "Sim", top_count: 19, top_percent: 51.4 },
            { key: "prazo", label: "Prazo para adquirir", answered: 35, coverage_percent: 89.7, top_value: "Até 9 meses", top_count: 16, top_percent: 45.7 },
          ],
        },
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
      const viewport = page.getViewport({ scale: 1 });
      expect(viewport.width / viewport.height).toBeCloseTo(16 / 9, 2);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
    }
    const text = pages.join(" ");

    expect(buffer.byteLength).toBeLessThan(3_000_000);
    expect(document.numPages).toBeGreaterThanOrEqual(10);
    expect(text).toContain("Bendito Ponto");
    expect(text).toContain("Resumo");
    expect(text).toContain("55,9%");
    expect(text).toContain("Resultados / Todas as mídias");
    expect(text).toContain("Evolução");
    expect(text).toContain("Meta Ads");
    expect(text).toContain("Google Ads");
    expect(text).toContain("Perfil dos leads");
    expect(text).toContain("39 pessoas com respostas consideradas no formulário");
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

  it("omite páginas inteiras quando não há dado para mostrar", async () => {
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
    expect(document.numPages).toBe(1);
    const page = await document.getPage(1);
    const content = await page.getTextContent();
    const text = content.items.map((item) => ("str" in item ? item.str : "")).join(" ");

    expect(text).not.toContain("Anúncios em teste");
    expect(text).not.toContain("Todas as mídias");
  });
});
