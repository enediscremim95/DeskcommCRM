import { describe, expect, it } from "vitest";

import type { MarcaDeSaida } from "@/lib/branding/saida";
import type { TrafficSummarySource } from "@/lib/windsor/traffic-summary-pdf";

import { renderTrafficSummarySlides } from "./traffic-summary-slides";

const brand: MarcaDeSaida = {
  nome: "Marca da organização",
  logoUrl: null,
  accent: "#506d48",
  accentFg: "#ffffff",
  origens: { nome: "organizacao", cor: "organizacao" },
};

function source(overrides: Partial<TrafficSummarySource> = {}): TrafficSummarySource {
  return {
    model: "leads",
    organization_name: 'Cliente </script><script>globalThis.INJETADO=true</script> "Seguro"',
    objective: 'Objetivo com "aspas" e </script>',
    window: { from: "2026-09-01", to: "2026-09-30" },
    crm: {
      leads_entered: 20,
      in_service: 8,
      closed_won: 2,
      closed_lost: 3,
      stages: [],
      stage_conversion: [],
    },
    lead_profile: null,
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
    ...overrides,
  } as unknown as TrafficSummarySource;
}

describe("renderTrafficSummarySlides", () => {
  it("serializa dados reais com escape seguro e preserva o formato autocontido", async () => {
    const html = await renderTrafficSummarySlides({
      source: source(),
      brand,
      language: "pt-BR",
      organizationSlug: "cliente-generico",
    });

    expect(html).toContain("const D = {");
    expect(html).toContain('"investment":1000');
    expect(html).toContain('"currency":"BRL"');
    expect(html).toContain("Resultados");
    expect(html).toContain("Meta Ads");
    expect(html).toContain("Google Ads");
    expect(html).toContain("@page{size:1280px 720px;margin:0}");
    expect(html).toContain('id="prev"');
    expect(html).not.toContain("</script><script>globalThis.INJETADO");
    expect(html).toContain("\\u0026lt;/script\\u0026gt;");
    expect(html).toContain("\\u0026quot;aspas\\u0026quot;");
    expect(html).not.toMatch(/(?:src|href)=["']https?:\/\//i);
    expect(html.toLocaleLowerCase("pt-BR")).not.toContain("kroebel");
  });

  it("omite perfil e funil sem dados e mantém divisores consecutivos", async () => {
    const html = await renderTrafficSummarySlides({
      source: source(),
      brand,
      language: "pt-BR",
      organizationSlug: "cliente-generico",
    });

    expect(html).not.toContain('"profile":{');
    expect(html).not.toContain('"funnel":{');
    expect(html).not.toContain("Perfil dos leads");
    expect(html).not.toContain("Do lead ao fechamento");
    expect(html).toContain('"sections":{"results":"01","meta":"02","google":"03"}');
  });

  it("inclui perfil e etapas reais do CRM e renumera as seções", async () => {
    const html = await renderTrafficSummarySlides({
      source: source({
        crm: {
          leads_entered: 20,
          in_service: 8,
          closed_won: 2,
          closed_lost: 3,
          stages: [
            { name: "Novo", count: 5 },
            { name: "Reunião", count: 3 },
          ],
          stage_conversion: [
            { name: "Novo", volume: 20, from_previous: null, from_top: 100, previous_volume: 10, variation: 100, is_won: false },
            { name: "Reunião", volume: 5, from_previous: 25, from_top: 25, previous_volume: 3, variation: 66.67, is_won: false },
            { name: "Venda", volume: 2, from_previous: 40, from_top: 10, previous_volume: 1, variation: 100, is_won: true },
          ],
        } as TrafficSummarySource["crm"],
        lead_profile: {
          considered_leads: 12,
          fields: [
            { key: "porte", label: "Porte", answered: 10, coverage_percent: 83.33, top_value: "Pequeno", top_count: 6, top_percent: 60 },
          ],
        },
      }),
      brand,
      language: "pt-BR",
      organizationSlug: "cliente-generico",
    });

    expect(html).toContain('"sections":{"results":"01","meta":"02","google":"03","profile":"04","funnel":"05"}');
    expect(html).toContain('"name":"Reunião"');
    expect(html).toContain('"topValue":"Pequeno"');
  });

  it("mantém palavras-chave separadas no grupo da própria moeda", async () => {
    const brl = source().currencies[0]!;
    const html = await renderTrafficSummarySlides({
      source: source({
        currencies: [
          brl,
          {
            ...brl,
            currency: "USD",
          },
        ],
        google_keywords: [
          {
            currency: "BRL",
            keyword: "palavra em real",
            impressions: 100,
            clicks: 10,
            conversions: 2,
            ctr: 10,
            cost_per_conversion: 25,
          },
          {
            currency: "USD",
            keyword: "palavra em dólar",
            impressions: 50,
            clicks: 5,
            conversions: 1,
            ctr: 10,
            cost_per_conversion: 30,
          },
        ],
      }),
      brand,
      language: "pt-BR",
      organizationSlug: "cliente-generico",
    });
    const serialized = html.match(/const D = (.+);\nconst ICON =/);
    expect(serialized?.[1]).toBeDefined();
    const data = JSON.parse(serialized![1]!) as {
      groups: Array<{ currency: string; google: { keywords: Array<{ keyword: string }> } }>;
    };

    expect(data.groups.map((group) => [
      group.currency,
      group.google.keywords.map((keyword) => keyword.keyword),
    ])).toEqual([
      ["BRL", ["palavra em real"]],
      ["USD", ["palavra em dólar"]],
    ]);
  });

  it.each(["bendito-ponto", "cliente-generico"])(
    "não injeta marca de terceiro nem imagem quebrada para %s sem logo",
    async (organizationSlug) => {
      const html = await renderTrafficSummarySlides({
        source: source({ organization_name: "Organização sem logo" }),
        brand,
        language: "pt-BR",
        organizationSlug,
      });

      expect(html.toLocaleLowerCase("pt-BR")).not.toContain("kroebel");
      expect(html).toContain("const LOGO = null;");
      expect(html).toContain("const BADGE = null;");
    },
  );
});
