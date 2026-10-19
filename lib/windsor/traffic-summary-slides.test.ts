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

type StageInput = {
  name: string;
  volume: number;
  from_previous: number | null;
  from_top: number | null;
  is_won: boolean;
};

function crmWithStages(stageConversion: StageInput[]): TrafficSummarySource["crm"] {
  return {
    leads_entered: 20,
    in_service: 8,
    closed_won: 2,
    closed_lost: 3,
    stages: [],
    stage_conversion: stageConversion,
  } as unknown as TrafficSummarySource["crm"];
}

function serializedFunnel(html: string): {
  objective: boolean;
  stages: Array<{
    name: string;
    volume: number;
    from_previous: number | null;
    cost_per_stage?: number | null;
  }>;
} | undefined {
  const serialized = html.match(/const D = (.+);\nconst ICON =/);
  expect(serialized?.[1]).toBeDefined();
  return (JSON.parse(serialized![1]!) as {
    funnel?: {
      objective: boolean;
      stages: Array<{
        name: string;
        volume: number;
        from_previous: number | null;
        cost_per_stage?: number | null;
      }>;
    };
  }).funnel;
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
    expect(html).toContain("Todas as mídias");
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

  it("omite perfil e funil sem dados", async () => {
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
  });

  it("omite os dois slides de perfil quando há só um campo com resposta", async () => {
    const html = await renderTrafficSummarySlides({
      source: source({
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

    expect(html).not.toContain('"profile":{');
    expect(html).not.toContain("Preenchimento do formulário");
    expect(html).not.toContain("Perfil dos leads");
    expect(html).not.toContain('"topValue":"Pequeno"');
  });

  it("inclui os dois slides de perfil com dois campos e mantém etapas reais do CRM", async () => {
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
            { key: "capital", label: "Capital", answered: 9, coverage_percent: 75, top_value: "Até 150 mil", top_count: 5, top_percent: 55.56 },
          ],
        },
      }),
      brand,
      language: "pt-BR",
      organizationSlug: "cliente-generico",
    });

    expect(html).toContain('"name":"Reunião"');
    expect(html).toContain('"topValue":"Pequeno"');
    expect(html).toContain('"topValue":"Até 150 mil"');
    expect(html).toContain("Preenchimento do formulário");
    expect(html).toContain("Perfil dos leads");
  });

  it("filtra 12 etapas para as 5 com volume antes de paginar e recalcula a conversão mostrada", async () => {
    const html = await renderTrafficSummarySlides({
      source: source({
        crm: crmWithStages([
          { name: "Novo", volume: 20, from_previous: null, from_top: 100, is_won: false },
          { name: "Carrinho abandonado", volume: 0, from_previous: 0, from_top: 0, is_won: false },
          { name: "Atendimento", volume: 8, from_previous: null, from_top: 40, is_won: false },
          { name: "Aguardando pagamento", volume: 0, from_previous: 0, from_top: 0, is_won: false },
          { name: "Reunião", volume: 4, from_previous: null, from_top: 20, is_won: false },
          { name: "Em separação", volume: 0, from_previous: 0, from_top: 0, is_won: false },
          { name: "Proposta", volume: 2, from_previous: null, from_top: 10, is_won: false },
          { name: "Enviado", volume: 0, from_previous: 0, from_top: 0, is_won: false },
          { name: "Venda", volume: 1, from_previous: null, from_top: 5, is_won: true },
          { name: "Entregue", volume: 0, from_previous: 0, from_top: 0, is_won: false },
          { name: "Pós-venda", volume: 0, from_previous: 0, from_top: 0, is_won: false },
          { name: "Stand by", volume: 0, from_previous: 0, from_top: 0, is_won: false },
        ]),
      }),
      brand,
      language: "pt-BR",
      organizationSlug: "cliente-generico",
    });

    const funnel = serializedFunnel(html);
    expect(funnel?.stages).toEqual([
      { name: "Novo", volume: 20, from_previous: null },
      { name: "Atendimento", volume: 8, from_previous: 40 },
      { name: "Reunião", volume: 4, from_previous: 50 },
      { name: "Proposta", volume: 2, from_previous: 50 },
      { name: "Venda", volume: 1, from_previous: 50 },
    ]);
    expect(Math.ceil((funnel?.stages.length ?? 0) / 6)).toBe(1);
  });

  it("mantém somente a última etapa de venda zerada quando nenhuma venda tem volume", async () => {
    const html = await renderTrafficSummarySlides({
      source: source({
        crm: crmWithStages([
          { name: "Novo", volume: 10, from_previous: null, from_top: 100, is_won: false },
          { name: "Venda antiga", volume: 0, from_previous: 0, from_top: 0, is_won: true },
          { name: "Contrato", volume: 0, from_previous: 0, from_top: 0, is_won: false },
          { name: "Venda final", volume: 0, from_previous: 0, from_top: 0, is_won: true },
        ]),
      }),
      brand,
      language: "pt-BR",
      organizationSlug: "cliente-generico",
    });

    expect(serializedFunnel(html)?.stages).toEqual([
      { name: "Novo", volume: 10, from_previous: null },
      { name: "Venda final", volume: 0, from_previous: 0 },
    ]);
  });

  it("não mantém venda zerada extra quando uma etapa de venda tem volume", async () => {
    const html = await renderTrafficSummarySlides({
      source: source({
        crm: crmWithStages([
          { name: "Novo", volume: 10, from_previous: null, from_top: 100, is_won: false },
          { name: "Venda", volume: 2, from_previous: 20, from_top: 20, is_won: true },
          { name: "Venda antiga", volume: 0, from_previous: 0, from_top: 0, is_won: true },
        ]),
      }),
      brand,
      language: "pt-BR",
      organizationSlug: "cliente-generico",
    });

    expect(serializedFunnel(html)?.stages).toEqual([
      { name: "Novo", volume: 10, from_previous: null },
      { name: "Venda", volume: 2, from_previous: 20 },
    ]);
  });

  it("usa os seis marcos objetivos, preserva o marco zerado e calcula custo por marco", async () => {
    const baseCurrency = source().currencies[0]!;
    const html = await renderTrafficSummarySlides({
      source: source({
        currencies: [
          {
            ...baseCurrency,
            summary: {
              ...baseCurrency.summary,
              spend: 4_323.84,
              leads: 56,
            },
          },
        ],
        crm: {
          ...crmWithStages([
            { name: "Lead Novo", volume: 56, from_previous: null, from_top: 100, is_won: false },
            { name: "Em Tentativa", volume: 40, from_previous: 71.4, from_top: 71.4, is_won: false },
            { name: "Reagendar/Noshow", volume: 3, from_previous: 7.5, from_top: 5.4, is_won: false },
          ]),
          report_funnel: [
            { name: "Leads", volume: 56, is_won: false },
            { name: "Leads contactados", volume: 23, is_won: false },
            { name: "Leads qualificados", volume: 2, is_won: false },
            { name: "Reuniões realizadas", volume: 2, is_won: false },
            { name: "COF", volume: 1, is_won: false },
            { name: "Vendas fechadas", volume: 0, is_won: true },
          ],
        } as unknown as TrafficSummarySource["crm"],
      }),
      brand,
      language: "pt-BR",
      organizationSlug: "bendito-ponto",
    });

    const funnel = serializedFunnel(html);
    expect(funnel?.objective).toBe(true);
    expect(funnel?.stages.map((stage) => stage.name)).toEqual([
      "Leads",
      "Leads contactados",
      "Leads qualificados",
      "Reuniões realizadas",
      "COF",
      "Vendas fechadas",
    ]);
    expect(funnel?.stages.map((stage) => stage.volume)).toEqual([56, 23, 2, 2, 1, 0]);
    expect(funnel?.stages[1]?.from_previous).toBeCloseTo(41.0714, 4);
    expect(funnel?.stages[2]?.from_previous).toBeCloseTo(8.6957, 4);
    expect(funnel?.stages[3]?.from_previous).toBe(100);
    expect(funnel?.stages[4]?.from_previous).toBe(50);
    expect(funnel?.stages[5]?.from_previous).toBe(0);
    expect(funnel?.stages[0]?.cost_per_stage).toBeCloseTo(77.2114, 4);
    expect(funnel?.stages[1]?.cost_per_stage).toBeCloseTo(187.993, 3);
    expect(funnel?.stages[5]?.cost_per_stage).toBeNull();
    expect(funnel?.stages.map((stage) => stage.name)).not.toContain("Em Tentativa");
    expect(funnel?.stages.map((stage) => stage.name)).not.toContain("Reagendar/Noshow");
    expect(html).toContain("D.labels.noData");
  });

  it("traduz os rótulos do funil objetivo para espanhol", async () => {
    const html = await renderTrafficSummarySlides({
      source: source({
        crm: {
          ...crmWithStages([]),
          report_funnel: [
            { name: "Leads", volume: 6, is_won: false },
            { name: "Leads contactados", volume: 5, is_won: false },
            { name: "Leads qualificados", volume: 4, is_won: false },
            { name: "Reuniões realizadas", volume: 3, is_won: false },
            { name: "COF", volume: 2, is_won: false },
            { name: "Vendas fechadas", volume: 1, is_won: true },
          ],
        } as unknown as TrafficSummarySource["crm"],
      }),
      brand,
      language: "es",
      organizationSlug: "bendito-ponto",
    });

    expect(serializedFunnel(html)?.stages.map((stage) => stage.name)).toEqual([
      "Leads",
      "Leads contactados",
      "Leads calificados",
      "Reuniones realizadas",
      "COF",
      "Ventas cerradas",
    ]);
    expect(html).toContain('\"noData\":\"sin dato\"');
  });

  it("remove divisores, fechamento, encerramento, variações fixas e objetivo genérico", async () => {
    const html = await renderTrafficSummarySlides({
      source: source({ objective: "" }),
      brand,
      language: "pt-BR",
      organizationSlug: "cliente-generico",
    });

    expect(html).not.toContain('class="slide divider"');
    expect(html).not.toContain('class="slide closing"');
    expect(html).not.toContain("Fechamento do período");
    expect(html).not.toContain("Foco de acompanhamento");
    expect(html).not.toContain("Variação em relação ao mês anterior");
    expect(html).not.toContain("RESULTADOS DE PERFORMANCE DO PERÍODO");
    expect(html).not.toContain("Segmentação: não informada");
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
