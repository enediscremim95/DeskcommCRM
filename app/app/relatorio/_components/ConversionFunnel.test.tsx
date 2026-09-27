import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { buildTrafficReport, type StoredFact } from "@/lib/windsor/report";
import {
  buildTrafficFunnelStages,
  ConversionFunnel,
  recalculateFunnelStages,
} from "./ConversionFunnel";

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
  beforeEach(() => localStorage.clear());

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

  it("prioriza o alcance agregado do período sem iniciar o funil em zero", () => {
    const [first] = buildTrafficFunnelStages(
      { ...metrics, reach: 730, impressions: 1_000 },
      "leads",
      "pt",
    );

    expect(first).toMatchObject({
      key: "reach",
      label: "Pessoas alcançadas",
      value: 730,
    });
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

  it("leva alcance agregado e frequência ao resumo e à plataforma", () => {
    const report = buildTrafficReport({
      model: "leads",
      conversionFields: ["actions_lead"],
      accounts: [
        { account_id: "acc-1", account_name: "Conta", platform: "meta_ads", currency: "BRL" },
      ],
      facts: [
        {
          account_id: "acc-1",
          platform: "meta_ads",
          occurred_on: "2026-09-18",
          campaign_id: "campaign-1",
          campaign_name: "Campanha",
          adset_id: null,
          adset_name: "",
          ad_id: null,
          ad_name: "",
          impressions: 1_000,
          reach: 0,
          clicks: 50,
          link_clicks: 40,
          spend: 100,
          conversions: { actions_lead: 4 },
          revenue: 0,
          video_views: 0,
          video_p25: 0,
          video_p50: 0,
          video_p75: 0,
          video_p95: 0,
          thumbnail_url: null,
          story_id: null,
        },
      ],
      accountReach: new Map([["acc-1", 800]]),
    });

    expect(report[0]?.summary.reach).toBe(800);
    expect(report[0]?.summary.frequency).toBe(1.25);
    expect(report[0]?.platforms[0]?.reach).toBe(800);
    expect(report[0]?.platforms[0]?.frequency).toBe(1.25);
  });

  it("conta a passagem em frase, aponta a menor e fixa o custo embaixo do número", () => {
    render(
      <ConversionFunnel
        title="Da entrada ao fechamento"
        idioma="pt"
        currency="BRL"
        stages={[
          {
            key: "clicks",
            label: "Cliques no link",
            value: 3_812,
            rate: null,
            asSource: "que clicaram",
          },
          {
            key: "leads",
            label: "Leads",
            value: 441,
            rate: 11.5,
            cost: 6.12,
            asSource: "que viraram leads",
            asTarget: "viraram leads",
            costLabel: "por lead",
          },
          { key: "won", label: "Fechados", value: 0, rate: 0, asTarget: "fecharam venda" },
        ]}
        summary={[{ label: "Custo por venda fechada", value: "sem dado", emphasis: true }]}
      />,
    );

    expect(
      screen.getByText("De 3,8 mil que clicaram, 441 viraram leads (11,5%)"),
    ).toBeInTheDocument();
    expect(screen.getByText("De 441 que viraram leads, 0 fecharam venda (0%)")).toBeInTheDocument();
    expect(screen.getByText("menor passagem do funil")).toBeInTheDocument();
    expect(screen.getByText(/R\$\s6,12 por lead/)).toBeInTheDocument();
    expect(screen.queryByText(/avançou/)).not.toBeInTheDocument();
    const cost = screen.getByText("Custo por venda fechada").parentElement;
    expect(cost).not.toBeNull();
    expect(within(cost!).getByText("sem dado")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("—");
  });

  it("só destaca a menor passagem quando há mais de uma para comparar", () => {
    render(
      <ConversionFunnel
        title="Curto"
        idioma="pt"
        stages={[
          { key: "a", label: "Impressões", value: 100, rate: null },
          { key: "b", label: "Cliques", value: 10, rate: 10 },
        ]}
        summary={[]}
      />,
    );
    expect(screen.queryByText("menor passagem do funil")).not.toBeInTheDocument();
  });

  it("recalcula a passagem entre as etapas que sobraram ao esconder a etapa do meio", () => {
    const visible = recalculateFunnelStages(
      [
        { key: "reach", label: "Alcance", value: 100, asSource: "que viram" },
        { key: "clicks", label: "Cliques", value: 40, asTarget: "clicaram" },
        { key: "leads", label: "Leads", value: 10, asTarget: "viraram leads" },
      ],
      ["reach", "leads"],
    );

    expect(visible.map((stage) => [stage.key, stage.rate])).toEqual([
      ["reach", null],
      ["leads", 10],
    ]);
  });

  it("oferece etapas reais do Kanban, aceita uma só e restaura a escolha persistida", async () => {
    const user = userEvent.setup();
    const stages = [
      { key: "reach", label: "Alcance", value: 100, asSource: "que viram" },
      { key: "leads", label: "Leads", value: 10, asTarget: "viraram leads" },
    ];
    const props = {
      title: "Do alcance à venda",
      stages,
      summary: [],
      idioma: "pt-BR",
      organizationKey: "org-1",
      viewerKey: "user-1",
      stageGroups: [
        { key: "report", label: "Métricas do relatório", stages },
        {
          key: "kanban",
          label: "Etapas do Kanban",
          stages: [{ key: "kanban:proposta", label: "Proposta enviada", value: 7 }],
        },
      ],
    };
    const first = render(<ConversionFunnel {...props} />);

    await user.click(screen.getByRole("button", { name: "Escolher etapas" }));
    await user.click(screen.getByRole("checkbox", { name: "Proposta enviada" }));
    expect(screen.getAllByText("7").length).toBeGreaterThan(0);
    expect(
      JSON.parse(localStorage.getItem("traffic-report-funnel-stages:org-1:user-1:funnel") ?? "[]"),
    ).toEqual(["reach", "leads", "kanban:proposta"]);

    await user.click(screen.getByRole("checkbox", { name: "Alcance" }));
    await user.click(screen.getByRole("checkbox", { name: "Leads" }));
    expect(screen.getByRole("checkbox", { name: "Proposta enviada" })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(screen.queryByText("Alcance")).not.toBeInTheDocument();

    first.unmount();
    render(<ConversionFunnel {...props} />);
    await user.click(screen.getByRole("button", { name: "Escolher etapas" }));
    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: "Proposta enviada" })).toBeChecked(),
    );
    expect(screen.getByRole("checkbox", { name: "Alcance" })).not.toBeChecked();
  });
});
