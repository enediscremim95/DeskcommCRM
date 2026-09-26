import { describe, expect, it } from "vitest";

import {
  buildFunnelReadings,
  buildTrafficKanbanStages,
  buildTrafficLeadSituation,
  buildTrafficRichCrmInsights,
} from "./traffic-insights";

describe("situação dos leads no relatório", () => {
  const stages = [
    { id: "new", name: "Novo", position: 10, is_won: false, is_lost: false },
    { id: "service", name: "Em atendimento", position: 20, is_won: false, is_lost: false },
    { id: "won", name: "Ganho", position: 30, is_won: true, is_lost: false },
    { id: "lost", name: "Perdido", position: 40, is_won: false, is_lost: true },
  ];

  it("conta estados, etapas e motivos sem expor dados pessoais", () => {
    const result = buildTrafficLeadSituation(
      [
        { status: "open", stage_id: "new", lost_reason: null },
        { status: "open", stage_id: "service", lost_reason: null },
        { status: "won", stage_id: "won", lost_reason: null },
        { status: "lost", stage_id: "lost", lost_reason: "Preço" },
        { status: "lost", stage_id: "lost", lost_reason: "Prazo" },
        { status: "lost", stage_id: "lost", lost_reason: "Preço" },
      ],
      stages,
    );

    expect(result).toEqual({
      leads_entered: 6,
      in_service: 2,
      closed_won: 1,
      closed_lost: 3,
      stages: [
        { name: "Novo", count: 1 },
        { name: "Em atendimento", count: 1 },
        { name: "Ganho", count: 1 },
        { name: "Perdido", count: 3 },
      ],
      loss_reasons: [
        { reason: "Preço", count: 2 },
        { reason: "Prazo", count: 1 },
      ],
    });
  });

  it("ignora motivo fora de lead perdido e etapa desconhecida", () => {
    const result = buildTrafficLeadSituation(
      [
        { status: "open", stage_id: "missing", lost_reason: "Não deveria contar" },
        { status: "won", stage_id: "won", lost_reason: null },
      ],
      stages,
    );

    expect(result.loss_reasons).toEqual([]);
    expect(result.stages).toEqual([{ name: "Ganho", count: 1 }]);
    expect(result).toMatchObject({
      leads_entered: 2,
      in_service: 1,
      closed_won: 1,
      closed_lost: 0,
    });
  });

  it("lê todas as etapas reais do Kanban e conta somente os leads na etapa exata", () => {
    expect(
      buildTrafficKanbanStages(
        [
          { status: "open", stage_id: "service", pipeline_id: "sales", lost_reason: null },
          { status: "open", stage_id: "service", pipeline_id: "sales", lost_reason: null },
          { status: "archived", stage_id: "new", pipeline_id: "sales", lost_reason: null },
        ],
        stages.map((stage) => ({ ...stage, pipeline_id: "sales" })),
      ),
    ).toEqual([
      { id: "new", pipeline_id: "sales", name: "Novo", position: 10, count: 0 },
      { id: "service", pipeline_id: "sales", name: "Em atendimento", position: 20, count: 2 },
      { id: "won", pipeline_id: "sales", name: "Ganho", position: 30, count: 0 },
      { id: "lost", pipeline_id: "sales", name: "Perdido", position: 40, count: 0 },
    ]);
  });
});

describe("dados ricos do CRM no período", () => {
  const stages = [
    { id: "new", pipeline_id: "sales", name: "Novo", position: 10, is_won: false, is_lost: false },
    {
      id: "service",
      pipeline_id: "sales",
      name: "Atendimento",
      position: 20,
      is_won: false,
      is_lost: false,
    },
    { id: "won", pipeline_id: "sales", name: "Ganho", position: 30, is_won: true, is_lost: false },
    {
      id: "lost",
      pipeline_id: "sales",
      name: "Perdido",
      position: 40,
      is_won: false,
      is_lost: true,
    },
  ];

  it("restringe situação, etapas, perdas, origem, vendas e valores à coorte do período", () => {
    const result = buildTrafficRichCrmInsights({
      window: { from: "2026-09-01", to: "2026-09-30" },
      stages,
      leads: [
        {
          id: "in-meta",
          pipeline_id: "sales",
          status: "won",
          stage_id: "won",
          lost_reason: null,
          created_at: "2026-09-02",
          closed_at: "2026-09-20",
          value_cents: 10000,
          currency: "BRL",
          source: "form",
          source_metadata: { ad_platform: "meta" },
        },
        {
          id: "in-google",
          pipeline_id: "sales",
          status: "lost",
          stage_id: "lost",
          lost_reason: "Preço",
          created_at: "2026-09-03",
          closed_at: "2026-09-10",
          value_cents: null,
          currency: null,
          source: "form",
          source_metadata: { utm_source: "google" },
        },
        {
          id: "outside",
          pipeline_id: "sales",
          status: "won",
          stage_id: "won",
          lost_reason: null,
          created_at: "2026-08-31",
          closed_at: "2026-09-05",
          value_cents: 900000,
          currency: "USD",
          source: "meta",
          source_metadata: {},
        },
      ],
    });

    expect(result).toMatchObject({ leads_entered: 2, closed_won: 1, closed_lost: 1 });
    expect(result.loss_reasons).toEqual([{ reason: "Preço", count: 1 }]);
    expect(result.sales_timeline).toEqual([{ period: "2026-09", count: 1, accumulated: 1 }]);
    expect(result.sales_values).toEqual([
      { currency: "BRL", total_cents: 10000, average_cents: 10000, sales: 1 },
    ]);
    expect(result.leads_by_origin).toEqual({ meta_ads: 1, google_ads: 1 });
    expect(result.won_by_origin).toEqual({ meta_ads: 1, google_ads: 0 });
    expect(result.leads_timeline).toEqual([{ period: "2026-09", count: 2 }]);
  });

  it("produz no máximo três leituras e compara taxas em pontos percentuais", () => {
    const readings = buildFunnelReadings(
      [
        { label: "Cliques", value: 100 },
        { label: "Leads", value: 40 },
        { label: "Vendas", value: 12 },
      ],
      [
        { label: "Cliques", value: 100 },
        { label: "Leads", value: 50 },
        { label: "Vendas", value: 10 },
      ],
    );
    expect(readings).toEqual([
      { kind: "lowest", from: "Leads", to: "Vendas", value: 30 },
      { kind: "drop", from: "Cliques", to: "Leads", value: -10 },
      { kind: "improvement", from: "Leads", to: "Vendas", value: 10 },
    ]);
  });
});
