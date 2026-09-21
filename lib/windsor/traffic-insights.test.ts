import { describe, expect, it } from "vitest";

import { buildTrafficLeadSituation } from "./traffic-insights";

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
    expect(result).toMatchObject({ leads_entered: 2, in_service: 1, closed_won: 1, closed_lost: 0 });
  });
});
