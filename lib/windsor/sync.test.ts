import { describe, expect, it, vi } from "vitest";

import type { WindsorRow } from "./types";
import {
  fetchSelectedAccountRows,
  filterRowsForAccount,
  type AccountRow,
  WINDSOR_FIELDS_BY_PLATFORM,
  WINDSOR_SUMMARY_FIELDS_BY_PLATFORM,
} from "./account-fetch";
import { normalizeFactsForAccount } from "./normalizer";

const account = (
  account_id: string,
  platform: AccountRow["platform"],
  organization_id = `org-${account_id}`,
): AccountRow => ({ account_id, platform, organization_id, account_name: account_id, currency: "BRL" });

describe("sincronização Windsor por conta", () => {
  it("filtra outra conta e outra plataforma antes de devolver linhas para gravação", () => {
    const selected = account("act_123", "meta_ads");
    const rows: WindsorRow[] = [
      { account_id: "123", date: "2026-09-18", spend: 10 },
      { account_id: "act_999", date: "2026-09-18", spend: 99 },
      { account_id: "123", data_source: "google_ads", date: "2026-09-18", cost: 88 },
    ];

    expect(filterRowsForAccount(rows, selected)).toEqual([
      { account_id: "act_123", date: "2026-09-18", spend: 10 },
    ]);
  });

  it("limita a três contas, serializa pedidos da mesma conta e isola falha parcial", async () => {
    const accounts = [
      account("act_1", "meta_ads", "org-a"),
      account("act_1", "meta_ads", "org-b"),
      account("act_2", "meta_ads"),
      account("act_3", "meta_ads"),
      account("act_4", "meta_ads"),
      account("act_5", "meta_ads"),
      account("123-456-7890", "google_ads"),
    ];
    let active = 0;
    let peak = 0;
    const activeByAccount = new Map<string, number>();
    let peakForSameAccount = 0;
    const fetcher = vi.fn(async (fields: readonly string[], accountId: string) => {
      active += 1;
      peak = Math.max(peak, active);
      const accountActive = (activeByAccount.get(accountId) ?? 0) + 1;
      activeByAccount.set(accountId, accountActive);
      peakForSameAccount = Math.max(peakForSameAccount, accountActive);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      activeByAccount.set(accountId, accountActive - 1);
      if (accountId === "act_3" && !fields.includes("ad_id")) throw new Error("timeout controlado");
      return [{
        account_id: accountId,
        date: "2026-09-18",
        spend: 1,
        ...(fields.includes("ad_id") ? { ad_id: "ad-1", ad_name: "Anúncio" } : {}),
      }];
    });

    const results = await fetchSelectedAccountRows(accounts, fetcher);

    expect(fetcher).toHaveBeenCalledTimes(22);
    expect(peak).toBeLessThanOrEqual(3);
    expect(peakForSameAccount).toBe(1);
    expect(results.get("meta_ads:act_1")?.rows).toHaveLength(2);
    expect(results.get("meta_ads:act_3")?.error).toBeInstanceOf(Error);
    expect(results.get("google_ads:123-456-7890")?.rows).toHaveLength(1);
  });

  it("grava Meta e Google pela plataforma configurada no mesmo ciclo", () => {
    const accounts = [
      account("1694716038241588", "meta_ads", "org-mista"),
      account("530-665-6052", "google_ads", "org-mista"),
    ];
    const rows: WindsorRow[] = [
      {
        account_id: "1694716038241588", date: "2026-09-18",
        campaign_name: "Meta", spend: 6089.27, cost: 0,
      },
      {
        account_id: "530-665-6052", date: "2026-09-18",
        campaign_name: "Google", spend: 0, cost: 901,
      },
    ];

    const facts = accounts.flatMap((selected) => normalizeFactsForAccount(
      filterRowsForAccount(rows, selected),
      selected,
    ));

    expect(facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ account_id: "1694716038241588", platform: "meta_ads", spend: 6089.27 }),
      expect.objectContaining({ account_id: "530-665-6052", platform: "google_ads", spend: 901 }),
    ]));
  });

  it("não inicia pedido novo depois do prazo global da coleta", async () => {
    const fetcher = vi.fn(async () => []);
    const results = await fetchSelectedAccountRows(
      [account("act_1", "meta_ads")],
      fetcher,
      Date.now() - 1,
    );

    expect(fetcher).not.toHaveBeenCalled();
    expect(results.get("meta_ads:act_1")?.error).toMatchObject({ message: "windsor_sync_deadline" });
  });

  it("combina métricas fragmentadas e miniatura sem data pelo anúncio", async () => {
    const fetcher = vi.fn(async (fields: readonly string[]) => {
      if (fields.includes("thumbnail_url")) {
        return [{ account_id: "act_1", ad_id: "ad-1", ad_name: "Anúncio", thumbnail_url: "https://img.test/1.jpg" }];
      }
      return [{
        account_id: "act_1", date: "2026-09-18", campaign_id: "camp-1", adset_id: "set-1",
        ...(fields.includes("ad_id") ? { ad_id: "ad-1", ad_name: "Anúncio" } : {}),
        ...(fields.includes("spend") ? { spend: 10 } : {}),
        ...(fields.includes("actions_lead") ? { actions_lead: 2 } : {}),
      }];
    });

    const result = (await fetchSelectedAccountRows([account("act_1", "meta_ads")], fetcher))
      .get("meta_ads:act_1");

    expect(result?.rows).toHaveLength(2);
    expect(result?.rows?.find((row) => row.ad_id === "ad-1")).toMatchObject({
      spend: 10,
      actions_lead: 2,
      thumbnail_url: "https://img.test/1.jpg",
    });
  });

  it("não envia campos exclusivos de Meta ao Google Ads", () => {
    expect(WINDSOR_FIELDS_BY_PLATFORM.google_ads).toContain("conversion_value");
    expect(WINDSOR_FIELDS_BY_PLATFORM.google_ads).not.toContain("thumbnail_url");
    expect(WINDSOR_FIELDS_BY_PLATFORM.meta_ads).toContain("thumbnail_url");
    expect(WINDSOR_FIELDS_BY_PLATFORM.meta_ads).toContain("ad_id");
    expect(WINDSOR_SUMMARY_FIELDS_BY_PLATFORM.meta_ads).not.toContain("ad_id");
    expect(WINDSOR_SUMMARY_FIELDS_BY_PLATFORM.meta_ads).toContain("adset_id");
    expect(WINDSOR_FIELDS_BY_PLATFORM.meta_ads).toContain("campaign_daily_budget");
    expect(WINDSOR_FIELDS_BY_PLATFORM.meta_ads).toContain("actions_landing_page_view");
    expect(WINDSOR_FIELDS_BY_PLATFORM.meta_ads).toContain("actions_add_to_cart");
  });
});
