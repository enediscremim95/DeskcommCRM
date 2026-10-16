import { expect, test, type Page } from "@playwright/test";

import type { MarcaDeSaida } from "../../lib/branding/saida";
import type { ThumbnailDependencies } from "../../lib/windsor/pdf-thumbnails";
import { renderTrafficSummarySlides } from "../../lib/windsor/traffic-summary-slides";
import type { TrafficSummarySource } from "../../lib/windsor/traffic-summary-pdf";

const brand: MarcaDeSaida = {
  nome: "Marca de teste",
  logoUrl: null,
  accent: "#506d48",
  accentFg: "#ffffff",
  origens: { nome: "organizacao", cor: "organizacao" },
};

const source = {
  model: "leads",
  organization_name: "Organização de teste",
  objective: "RESULTADOS DE PERFORMANCE DO PERÍODO",
  window: { from: "2026-09-01", to: "2026-09-30" },
  crm: {
    leads_entered: 20,
    in_service: 8,
    closed_won: 2,
    closed_lost: 3,
    stage_conversion: [
      { name: "Novo", volume: 20, from_previous: null, from_top: 100, is_won: false },
      { name: "Carrinho abandonado", volume: 0, from_previous: 0, from_top: 0, is_won: false },
      { name: "Atendimento", volume: 8, from_previous: 40, from_top: 40, is_won: false },
      { name: "Aguardando pagamento", volume: 0, from_previous: 0, from_top: 0, is_won: false },
      { name: "Reunião", volume: 5, from_previous: 62.5, from_top: 25, is_won: false },
      { name: "Pago", volume: 0, from_previous: 0, from_top: 0, is_won: true },
      { name: "Proposta", volume: 3, from_previous: 60, from_top: 15, is_won: false },
      { name: "Em separação", volume: 0, from_previous: 0, from_top: 0, is_won: false },
      { name: "Enviado", volume: 0, from_previous: 0, from_top: 0, is_won: false },
      { name: "Venda", volume: 2, from_previous: 25, from_top: 10, is_won: true },
      { name: "Entregue", volume: 0, from_previous: 0, from_top: 0, is_won: false },
      { name: "Pós-venda", volume: 0, from_previous: 0, from_top: 0, is_won: false },
    ],
  },
  lead_profile: {
    considered_leads: 12,
    fields: [
      {
        key: "perfil",
        label: "Perfil informado",
        answered: 10,
        coverage_percent: 83.33,
        top_value: "Empreendedor",
        top_count: 7,
        top_percent: 70,
      },
      {
        key: "capital",
        label: "Capital",
        answered: 9,
        coverage_percent: 75,
        top_value: "Até 150 mil",
        top_count: 5,
        top_percent: 55.56,
      },
    ],
  },
  historico: [
    {
      currency: "BRL",
      periods: [
        { from: "2026-08-01", to: "2026-08-31", spend: 800, leads: 8, cost_per_lead: 100 },
        { from: "2026-09-01", to: "2026-09-30", spend: 1_000, leads: 10, cost_per_lead: 100 },
      ],
    },
  ],
  currencies: [
    {
      currency: "BRL",
      summary: {
        spend: 1_000,
        reach: 8_000,
        impressions: 10_000,
        clicks: 500,
        link_clicks: 400,
        leads: 10,
        cost_per_lead: 100,
        ctr: 5,
        conversion_rate: 2,
      },
      platforms: [
        {
          platform: "meta_ads",
          spend: 700,
          reach: 6_000,
          impressions: 8_000,
          clicks: 400,
          link_clicks: 350,
          leads: 8,
          cost_per_lead: 87.5,
          ctr: 5,
          conversion_rate: 2,
          video_views: 2_000,
          video_p25: 1_200,
          video_p50: 800,
          video_p75: 500,
          video_p95: 200,
        },
        {
          platform: "google_ads",
          spend: 300,
          reach: null,
          impressions: 2_000,
          clicks: 100,
          link_clicks: 50,
          leads: 2,
          cost_per_lead: 150,
          ctr: 5,
          conversion_rate: 2,
        },
      ],
      campaigns: [],
    },
  ],
} as unknown as TrafficSummarySource;

const emptyOptionalSource = {
  ...source,
  objective: "",
  google_keywords: [
    {
      currency: "BRL",
      keyword: "   ",
      impressions: null,
      clicks: null,
      conversions: null,
      ctr: null,
      cost_per_conversion: null,
    },
  ],
  currencies: source.currencies.map((group) => ({
    ...group,
    platforms: group.platforms?.map((platform) =>
      platform.platform === "meta_ads"
        ? {
            ...platform,
            video_views: 0,
            video_p25: null,
            video_p50: 0,
            video_p75: null,
            video_p95: 0,
          }
        : platform,
    ),
  })),
} as unknown as TrafficSummarySource;

const completeSource = {
  ...source,
  google_keywords: [
    {
      currency: "BRL",
      keyword: "crm para vendas",
      impressions: 200,
      clicks: 20,
      conversions: 4,
      ctr: 10,
      cost_per_conversion: 25,
    },
  ],
  currencies: source.currencies.map((group) => ({
    ...group,
    campaigns: [
      {
        platform: "meta_ads",
        name: "Campanha real",
        campaign_status: "ACTIVE",
        adsets: [
          {
            name: "Conjunto real",
            ads: [
              {
                name: "Anúncio real",
                spend: 100,
                impressions: 1_000,
                leads: 5,
                cost_per_lead: 20,
                thumbnail_url: "https://images.example/anuncio.png",
                destination_urls: [],
                first_delivery_on: null,
                last_delivery_on: null,
              },
            ],
          },
        ],
      },
    ],
  })),
} as unknown as TrafficSummarySource;

const imageDependencies: ThumbnailDependencies = {
  lookupFn: async () => [{ address: "1.1.1.1", family: 4 }],
  fetchFn: async () =>
    new Response(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
      { status: 200, headers: { "content-type": "image/png" } },
    ),
};

async function openGeneratedHtml(
  page: Page,
  width: number,
  generatedSource: TrafficSummarySource = source,
  dependencies?: ThumbnailDependencies,
): Promise<string[]> {
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.setViewportSize({ width, height: width === 1280 ? 720 : 900 });
  const html = await renderTrafficSummarySlides({
    source: generatedSource,
    brand,
    language: "pt-BR",
    organizationSlug: "organizacao-de-teste",
    imageDependencies: dependencies,
  });
  await page.setContent(html, { waitUntil: "load" });
  return browserErrors;
}

test("cenário completo fica com 13 slides sem divisores, fechamento ou encerramento", async ({ page }) => {
  const browserErrors = await openGeneratedHtml(page, 1280, completeSource, imageDependencies);
  const titles = await page.locator("h2.title").allTextContents();

  await expect(page.locator(".slide")).toHaveCount(13);
  await expect(page.locator(".slide.divider")).toHaveCount(0);
  await expect(page.locator(".slide.closing")).toHaveCount(0);
  await expect(page.locator(".chev-var")).toHaveCount(0);
  await expect(page.locator(".chev-legend")).toHaveCount(0);
  expect(titles).not.toContain("Fechamento do período");
  expect(titles).not.toContain("Foco de acompanhamento");
  expect(titles).toContain("Preenchimento do formulário");
  expect(titles).toContain("Perfil dos leads");
  await expect(page.getByText("viram até o fim", { exact: true })).toHaveCount(1);

  const funnel = page.locator("section.slide.content").filter({
    has: page.locator("h2.title", { hasText: /^Do lead ao fechamento$/ }),
  });
  await expect(funnel).toHaveCount(1);
  await expect(funnel.locator(".fun-row")).toHaveCount(5);
  await expect(funnel).toContainText("Venda");
  await expect(funnel).not.toContainText("Carrinho abandonado");

  const allMedia = page.locator("section.slide.content").filter({
    has: page.locator("h2.title", { hasText: /^Todas as mídias$/ }),
  });
  const meta = page.locator("section.slide.content").filter({
    has: page.locator("h2.title", { hasText: /^Meta Ads$/ }),
  });
  const google = page.locator("section.slide.content").filter({
    has: page.locator("h2.title", { hasText: /^Google Ads$/ }),
  });
  await expect(allMedia.locator(".pills")).toHaveCount(0);
  await expect(meta.locator(".pills")).toHaveCount(0);
  await expect(google.locator(".pills")).toContainText("CTR = 5,00%");
  await expect(google.locator(".pills")).toContainText("2,00% clique → lead");

  const ranking = page.locator("section.slide.content").filter({
    has: page.locator("h2.title", { hasText: /^Meta Ads: ranking de criativos$/ }),
  });
  await expect(ranking.locator(".frame")).toHaveCount(1);
  await expect(ranking.locator(".frame img")).toHaveCount(1);
  await expect(ranking).not.toContainText("imagem não disponível");

  const keywords = page.locator("section.slide.content").filter({
    has: page.locator("h2.title", { hasText: /^Google Ads: melhores palavras$/ }),
  });
  await expect(keywords.locator("tbody tr")).toHaveCount(1);
  expect(browserErrors).toEqual([]);
});

test("imprime como PDF com uma página 1280x720 por slide, sem página sobrando", async ({ page }) => {
  await openGeneratedHtml(page, 1280, completeSource, imageDependencies);
  const slides = await page.locator(".slide").count();
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  const texto = pdf.toString("latin1");
  const paginas = (texto.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  const caixa = texto.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);

  expect(slides).toBe(13);
  expect(paginas).toBe(slides);
  // 1280px x 720px em pontos (96 dpi para 72 dpi): 960 x 540.
  expect(Number(caixa?.[1])).toBeCloseTo(960, 0);
  expect(Number(caixa?.[2])).toBeCloseTo(540, 0);
});

test("omite ranking, vídeo e palavras-chave quando estão vazios", async ({ page }) => {
  const browserErrors = await openGeneratedHtml(page, 1280, emptyOptionalSource);
  const titles = await page.locator("h2.title").allTextContents();

  expect(titles).not.toContain("Meta Ads: ranking de criativos");
  expect(titles).not.toContain("Meta Ads: retenção de vídeo");
  expect(titles).not.toContain("Google Ads: melhores palavras");
  await expect(page.locator(".obj")).toHaveCount(0);
  await expect(page.getByText("Segmentação: não informada", { exact: true })).toHaveCount(0);
  expect(browserErrors).toEqual([]);
});

for (const width of [375, 768] as const) {
  test(`abre em fluxo a ${width}px sem estouro horizontal`, async ({ page }) => {
    const browserErrors = await openGeneratedHtml(page, width);

    await expect(page.locator("body")).toHaveClass(/flow/);
    expect(await page.locator(".slide").count()).toBeGreaterThan(8);
    await expect(page.locator(".slide").nth(1)).toBeVisible();
    const measurement = await page.evaluate(() => ({
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      slidesVisible: [...document.querySelectorAll<HTMLElement>(".slide")].every(
        (slide) => getComputedStyle(slide).display !== "none" && slide.offsetWidth > 0,
      ),
    }));
    expect(measurement.documentWidth).toBeLessThanOrEqual(measurement.viewport + 1);
    expect(measurement.slidesVisible).toBe(true);
    expect(browserErrors).toEqual([]);
  });
}

test("abre no palco de 1280px e navega por teclado e botões", async ({ page }) => {
  const browserErrors = await openGeneratedHtml(page, 1280);
  const slides = page.locator(".slide");
  const total = await slides.count();

  expect(total).toBeGreaterThan(8);
  await expect(page.locator("body")).not.toHaveClass(/flow/);
  await expect(page.locator(".slide.active")).toHaveCount(1);
  await expect(page.locator("#ct")).toHaveText(`1 / ${total}`);

  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#ct")).toHaveText(`2 / ${total}`);
  await page.locator("#next").click();
  await expect(page.locator("#ct")).toHaveText(`3 / ${total}`);
  await page.locator("#prev").click();
  await expect(page.locator("#ct")).toHaveText(`2 / ${total}`);

  const stage = await page.locator("#stage").boundingBox();
  expect(stage?.width).toBe(1280);
  expect(stage?.height).toBe(720);
  expect(browserErrors).toEqual([]);
});
