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

  it("agrupa detalhes diferentes de Outro na mesma categoria", () => {
    const result = buildTrafficLeadSituation(
      [
        {
          status: "lost",
          stage_id: "lost",
          lost_reason: "other",
          lost_reason_detail: "Mudou de cidade",
        },
        {
          status: "lost",
          stage_id: "lost",
          lost_reason: "other",
          lost_reason_detail: "Pausou o projeto",
        },
      ],
      stages,
    );

    expect(result.loss_reasons).toEqual([{ reason: "other", count: 2 }]);
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

  it("monta os marcos objetivos cumulativos por posição e trata posições iguais como o mesmo nível", () => {
    const objectiveStages = [
      { id: "new", pipeline_id: "sales", name: "Lead Novo", position: 10, is_won: false, is_lost: false },
      { id: "attempt", pipeline_id: "sales", name: "Em Tentativa", position: 20, is_won: false, is_lost: false },
      { id: "contacted", pipeline_id: "sales", name: "Contato Realizado", position: 30, is_won: false, is_lost: false },
      { id: "contacted-peer", pipeline_id: "sales", name: "Retorno do contato", position: 30, is_won: false, is_lost: false },
      { id: "scheduled", pipeline_id: "sales", name: "Reunião Agendada", position: 40, is_won: false, is_lost: false },
      { id: "qualified-peer", pipeline_id: "sales", name: "Qualificado", position: 40, is_won: false, is_lost: false },
      { id: "noshow", pipeline_id: "sales", name: "Reagendar/Noshow", position: 50, is_won: false, is_lost: false },
      { id: "meeting", pipeline_id: "sales", name: "Reunião Realizada", position: 60, is_won: false, is_lost: false },
      { id: "cof", pipeline_id: "sales", name: "COF Enviada", position: 70, is_won: false, is_lost: false },
      { id: "won", pipeline_id: "sales", name: "Contrato", position: 80, is_won: true, is_lost: false },
      { id: "lost", pipeline_id: "sales", name: "Perdido", position: 90, is_won: false, is_lost: true },
    ];
    const result = buildTrafficRichCrmInsights({
      window: { from: "2026-09-01", to: "2026-09-30" },
      stages: objectiveStages,
      pipelines: [
        {
          id: "sales",
          position: 1,
          settings: {
            report_funnel: [
              { label: "Leads", stage_names: [] },
              { label: "Leads contactados", stage_names: ["Contato Realizado"] },
              { label: "Leads qualificados", stage_names: ["Reunião Agendada"] },
              { label: "Reuniões realizadas", stage_names: ["Reunião Realizada"] },
              { label: "COF", stage_names: ["COF Enviada"] },
              { label: "Vendas fechadas", stage_names: ["Contrato"] },
            ],
          },
        },
      ],
      leads: ([
        ["lead-new", "new", "open"],
        ["lead-contacted", "contacted", "open"],
        ["lead-contacted-peer", "contacted-peer", "open"],
        ["lead-scheduled", "scheduled", "open"],
        ["lead-qualified-peer", "qualified-peer", "open"],
        ["lead-noshow", "noshow", "open"],
        ["lead-meeting", "meeting", "open"],
        ["lead-cof", "cof", "open"],
        ["lead-won", "won", "won"],
        ["lead-lost", "lost", "lost"],
      ] satisfies Array<[string, string, string]>).map(([id, stage_id, status]) => ({
        id,
        pipeline_id: "sales",
        stage_id,
        status,
        lost_reason: null,
        created_at: "2026-09-10",
      })),
    });

    expect(result.report_funnel?.map(({ name, volume, from_previous }) => ({
      name,
      volume,
      from_previous,
    }))).toEqual([
      { name: "Leads", volume: 10, from_previous: null },
      { name: "Leads contactados", volume: 8, from_previous: 80 },
      { name: "Leads qualificados", volume: 6, from_previous: 75 },
      { name: "Reuniões realizadas", volume: 3, from_previous: 50 },
      { name: "COF", volume: 2, from_previous: (2 / 3) * 100 },
      { name: "Vendas fechadas", volume: 1, from_previous: 50 },
    ]);
  });

  it("mantém o funil interno quando não há configuração objetiva válida", () => {
    const args = {
      window: { from: "2026-09-01", to: "2026-09-30" },
      stages,
      leads: [
        {
          id: "lead-service",
          pipeline_id: "sales",
          status: "open",
          stage_id: "service",
          lost_reason: null,
          created_at: "2026-09-10",
        },
      ],
    };

    const withoutConfig = buildTrafficRichCrmInsights(args);
    const invalidConfig = buildTrafficRichCrmInsights({
      ...args,
      pipelines: [
        {
          id: "sales",
          settings: {
            report_funnel: [
              { label: "Leads", stage_names: [] },
              { label: "Etapa inexistente", stage_names: ["Não existe"] },
            ],
          },
        },
      ],
    });

    expect(withoutConfig).not.toHaveProperty("report_funnel");
    expect(invalidConfig).not.toHaveProperty("report_funnel");
    expect(invalidConfig.stage_conversion).toEqual(withoutConfig.stage_conversion);
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
