import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { buildTrafficReport, type StoredFact } from "@/lib/windsor/report";
import { buildTrafficFunnelStages, ConversionFunnel } from "./ConversionFunnel";

const metrics = {
  impressions: 1_000,
  clicks: 80,
  link_clicks: 50,
  landing_page_views: 0,
  landing_page_views_available: false,
  leads: 5,
  add_to_cart: 4,
  add_to_cart_available: true,
  initiate_checkout: 3,
  initiate_checkout_available: true,
  conversions: 2,
  messaging_conversations: 0,
  messaging_conversations_available: true,
};

describe("funil visual de conversão", () => {
  it("monta cada modelo e remove somente etapas sem medição", () => {
    expect(buildTrafficFunnelStages(metrics, "leads", "pt").map((stage) => stage.key)).toEqual([
      "impressions",
      "clicks",
      "leads",
    ]);
    expect(
      buildTrafficFunnelStages(metrics, "messages", "pt").map((stage) => [stage.key, stage.value]),
    ).toEqual([
      ["impressions", 1_000],
      ["clicks", 80],
      ["messages", 0],
    ]);
    expect(
      buildTrafficFunnelStages(
        { ...metrics, landing_page_views_available: true },
        "ecommerce",
        "pt",
      ).map((stage) => stage.key),
    ).toEqual(["impressions", "clicks", "page", "cart", "checkout", "purchases"]);
  });

  it("preserva uma etapa medida com valor zero no agregado Windsor", () => {
    const fact: StoredFact = {
      account_id: "acc-1",
      platform: "meta_ads",
      occurred_on: "2026-09-18",
      campaign_id: "campaign-1",
      campaign_name: "Campanha",
      adset_id: null,
      adset_name: "",
      ad_id: null,
      ad_name: "",
      impressions: 100,
      reach: 80,
      clicks: 10,
      link_clicks: 8,
      spend: 20,
      conversions: { actions_landing_page_view: 0 },
      revenue: 0,
      video_views: 0,
      video_p25: 0,
      video_p50: 0,
      video_p75: 0,
      video_p95: 0,
      thumbnail_url: null,
      story_id: null,
    };
    const report = buildTrafficReport({
      model: "leads",
      conversionFields: ["actions_lead"],
      accounts: [
        { account_id: "acc-1", account_name: "Conta", platform: "meta_ads", currency: "BRL" },
      ],
      facts: [fact],
    });

    expect(report[0]?.summary.landing_page_views).toBe(0);
    expect(report[0]?.summary.landing_page_views_available).toBe(true);
  });

  it("expõe taxas de passagem e mantém custo sem fechamento como indisponível", () => {
    render(
      <ConversionFunnel
        title="Da entrada ao fechamento"
        description="Estado atual"
        idioma="pt"
        stages={[
          { key: "entered", label: "Leads que entraram", value: 20, rate: null },
          { key: "service", label: "Em atendimento", value: 12, rate: 60 },
          { key: "won", label: "Fechados", value: 0, rate: 0 },
        ]}
        summary={[{ label: "Custo por venda fechada", value: "—", emphasis: true }]}
      />,
    );

    expect(screen.getByText("60% avançou")).toBeInTheDocument();
    expect(screen.getByText("0% avançou")).toBeInTheDocument();
    const cost = screen.getByText("Custo por venda fechada").parentElement;
    expect(cost).not.toBeNull();
    expect(within(cost!).getByText("—")).toBeInTheDocument();
  });
});
