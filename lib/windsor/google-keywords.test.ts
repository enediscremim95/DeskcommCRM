import { describe, expect, it, vi } from "vitest";

import type { AccountRow } from "./account-fetch";
import {
  aggregateGoogleKeywords,
  fetchGoogleKeywords,
  GOOGLE_KEYWORD_FIELDS,
} from "./google-keywords";

function account(account_id: string, currency: string): AccountRow {
  return {
    organization_id: "org-1",
    account_id,
    platform: "google_ads",
    account_name: account_id,
    currency,
  };
}

describe("palavras-chave Google Ads", () => {
  it("deduplica, agrega por texto e moeda, recalcula métricas e ordena", () => {
    const brlA = account("111-111-1111", "BRL");
    const brlB = account("222-222-2222", "BRL");
    const usd = account("333-333-3333", "USD");
    const duplicated = {
      account_id: brlA.account_id,
      keyword_text: "mais cliques",
      keyword_match_type: "EXACT",
      impressions: 100,
      clicks: 15,
      conversions: 1,
      cost: 20,
      ctr: 999,
    };

    const result = aggregateGoogleKeywords([
      {
        account: brlA,
        rows: [
          duplicated,
          { ...duplicated },
          {
            account_id: brlA.account_id,
            keyword_text: "alta conversão",
            keyword_match_type: "BROAD",
            impressions: 50,
            clicks: 10,
            conversions: 5,
            cost: 100,
          },
          {
            account_id: brlA.account_id,
            keyword_text: "sem impressão",
            impressions: 0,
            clicks: 99,
            conversions: 9,
            cost: 999,
          },
        ],
      },
      {
        account: brlB,
        rows: [
          {
            account_id: brlB.account_id,
            keyword_text: "mais cliques",
            keyword_match_type: "BROAD",
            impressions: 100,
            clicks: 25,
            conversions: 2,
            cost: 40,
          },
          {
            account_id: brlB.account_id,
            keyword_text: "menos cliques",
            keyword_match_type: "PHRASE",
            impressions: 200,
            clicks: 20,
            conversions: 3,
            cost: 90,
          },
        ],
      },
      {
        account: usd,
        rows: [
          {
            account_id: usd.account_id,
            keyword_text: "mais cliques",
            keyword_match_type: "EXACT",
            impressions: 10,
            clicks: 2,
            conversions: 0,
            cost: 12,
          },
        ],
      },
    ]);

    expect(result.map(({ currency, keyword }) => [currency, keyword])).toEqual([
      ["BRL", "alta conversão"],
      ["BRL", "mais cliques"],
      ["BRL", "menos cliques"],
      ["USD", "mais cliques"],
    ]);
    expect(result[1]).toEqual({
      currency: "BRL",
      keyword: "mais cliques",
      impressions: 200,
      clicks: 40,
      conversions: 3,
      ctr: 20,
      cost_per_conversion: 20,
    });
    expect(result[3]?.cost_per_conversion).toBeNull();
  });

  it("busca cada conta no período exato e limita a chamada ao prazo restante", async () => {
    const selected = account("111-111-1111", "BRL");
    const fetcher = vi.fn(
      async (
        _fields: readonly string[],
        _accountId: string,
        _platform: "google_ads",
        _range: { from: string; to: string },
        _timeoutMs?: number,
      ) => [
        {
          account_id: selected.account_id,
          keyword_text: "palavra válida",
          impressions: 10,
          clicks: 1,
          conversions: 0,
          cost: 5,
        },
        {
          account_id: "999-999-9999",
          keyword_text: "outra conta",
          impressions: 999,
          clicks: 999,
          conversions: 999,
          cost: 999,
        },
      ],
    );
    const deadlineAt = Date.now() + 5_000;

    const result = await fetchGoogleKeywords(
      [selected],
      { from: "2026-09-01", to: "2026-09-30" },
      fetcher,
      deadlineAt,
    );

    expect(fetcher).toHaveBeenCalledWith(
      GOOGLE_KEYWORD_FIELDS,
      selected.account_id,
      "google_ads",
      { from: "2026-09-01", to: "2026-09-30" },
      expect.any(Number),
    );
    const timeoutMs = fetcher.mock.calls[0]?.[4];
    expect(timeoutMs).toBeGreaterThan(0);
    expect(timeoutMs).toBeLessThanOrEqual(5_000);
    expect(result.map((row) => row.keyword)).toEqual(["palavra válida"]);
  });
});
