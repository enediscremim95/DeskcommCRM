import { expect, test, type Page } from "@playwright/test";

import type { MarcaDeSaida } from "../../lib/branding/saida";
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
      { name: "Atendimento", volume: 8, from_previous: 40, from_top: 40, is_won: false },
      { name: "Venda", volume: 2, from_previous: 25, from_top: 10, is_won: true },
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

async function openGeneratedHtml(page: Page, width: number): Promise<string[]> {
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.setViewportSize({ width, height: width === 1280 ? 720 : 900 });
  const html = await renderTrafficSummarySlides({
    source,
    brand,
    language: "pt-BR",
    organizationSlug: "organizacao-de-teste",
  });
  await page.setContent(html, { waitUntil: "load" });
  return browserErrors;
}

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
