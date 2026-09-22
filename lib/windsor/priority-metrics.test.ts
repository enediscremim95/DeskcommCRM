import { describe, expect, it } from "vitest";

import {
  defaultPriorityMetrics,
  priorityMetricValue,
  validPriorityMetrics,
} from "./priority-metrics";

describe("métricas prioritárias do relatório", () => {
  it("preserva os quatro cartões atuais quando a organização não configurou", () => {
    expect(validPriorityMetrics(null, "leads")).toEqual([
      "spend",
      "reach",
      "leads",
      "cost_per_lead",
    ]);
    expect(defaultPriorityMetrics("messages")).toEqual([
      "spend",
      "messaging_conversations",
      "cost_per_messaging_conversation",
      "crm_closed_won",
    ]);
    expect(defaultPriorityMetrics("ecommerce")).toEqual([
      "revenue",
      "roas",
      "purchases",
      "crm_closed_won",
    ]);
  });

  it("mantém a escolha salva na ordem e rejeita configurações inválidas", () => {
    expect(validPriorityMetrics(["roas", "revenue", "crm_closed_won"], "ecommerce")).toEqual([
      "roas",
      "revenue",
      "crm_closed_won",
    ]);
    expect(validPriorityMetrics(["spend", "spend"], "leads")).toEqual(
      defaultPriorityMetrics("leads"),
    );
    expect(validPriorityMetrics([], "leads")).toEqual(defaultPriorityMetrics("leads"));
  });

  it("calcula fechadas e custo por venda fechada com os valores do período", () => {
    const summary = { spend: 900 };
    expect(priorityMetricValue("crm_closed_won", summary, 3)).toBe(3);
    expect(priorityMetricValue("cost_per_crm_closed_won", summary, 3)).toBe(300);
    expect(priorityMetricValue("cost_per_crm_closed_won", summary, 0)).toBeNull();
  });

  it("preserva vendas por conversão quando a compra específica não veio", () => {
    expect(priorityMetricValue("purchases", { spend: 500, purchases: 0, conversions: 7 }, 0)).toBe(
      7,
    );
  });
});
