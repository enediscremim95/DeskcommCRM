import { describe, expect, it } from "vitest";
import { deduplicateRows, discoverAccounts, normalizeFacts, repairMojibake } from "./normalizer";

describe("normalizador Windsor", () => {
  it("não inventa moeda ao descobrir contas", () => {
    expect(discoverAccounts([
      { account_id: "act_1", account_name: "Meta sem moeda", data_source: "facebook" },
      { account_id: "123", account_name: "Google", data_source: "google", currency: "USD" },
    ])).toEqual([{ id: "123", name: "Google", platform: "google_ads", currency: "USD" }]);
  });

  it("não deduplica linhas iguais de contas diferentes", () => {
    const base = { date: "2026-09-18", campaign_name: "Campanha", spend: 10, impressions: 100 };
    const result = deduplicateRows([
      { ...base, account_id: "act_1" },
      { ...base, account_id: "act_1" },
      { ...base, account_id: "act_2" },
    ]);
    expect(result.removed).toBe(1);
    expect(result.rows).toHaveLength(2);
  });

  it("não deduplica campanhas distintas que compartilham o mesmo nome", () => {
    const base = { account_id: "act_1", date: "2026-09-18", campaign_name: "Campanha", spend: 10, impressions: 100 };
    expect(deduplicateRows([
      { ...base, campaign_id: "campaign-1" },
      { ...base, campaign_id: "campaign-2" },
    ]).rows).toHaveLength(2);
  });

  it("usa cost no Google e mantém linha somente com conversão", () => {
    const [fact] = normalizeFacts([{
      date: "2026-09-18", data_source: "google", account_id: "123",
      campaign_name: "Pesquisa", cost: "20.5", spend: "999",
      actions_lead: 1, conversions: 2,
    }], "google_ads");
    expect(fact).toBeDefined();
    expect(fact!.spend).toBe(20.5);
    expect(fact!.conversions).toMatchObject({ actions_lead: 1, conversions: 2 });
  });

  it("preserva ações novas e orçamento Meta no json de métricas", () => {
    const [fact] = normalizeFacts([{
      date: "2026-09-18", account_id: "act_1", campaign_name: "Meta",
      actions_landing_page_view: 8, actions_add_to_cart: 3,
      campaign_daily_budget: 12500,
    }], "meta_ads");
    expect(fact?.conversions).toMatchObject({
      actions_landing_page_view: 8,
      actions_add_to_cart: 3,
      campaign_daily_budget: 12500,
    });
  });

  it("interrompe carga material degradada sem nome de campanha", () => {
    expect(() => normalizeFacts([
      { date: "2026-09-18", account_id: "act_1", spend: 10 },
      { date: "2026-09-18", account_id: "act_1", spend: 5 },
      { date: "2026-09-18", account_id: "act_1", spend: 1, campaign_name: "Válida" },
    ], "meta_ads")).toThrow("windsor_campaign_names_degraded");
  });

  it("repara mojibake sem corromper texto válido", () => {
    expect(repairMojibake("ConfiguraÃ§Ã£o")).toBe("Configuração");
    expect(repairMojibake("Campanha válida")).toBe("Campanha válida");
  });
});
