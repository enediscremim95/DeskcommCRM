import { describe, expect, it, vi } from "vitest";

import { logger } from "@/lib/logger";
import type { WindsorRow } from "./types";
import {
  fetchSelectedAccountRows,
  filterRowsForAccount,
  type AccountRow,
  WINDSOR_FIELDS_BY_PLATFORM,
  WINDSOR_SUMMARY_FIELDS_BY_PLATFORM,
} from "./account-fetch";
import { normalizeFactsForAccount } from "./normalizer";
import type { DateRange } from "./request";
import {
  configUpdateForSyncFailure,
  orderAccountsByOldestOrganizationSync,
} from "./sync-policy";

const account = (
  account_id: string,
  platform: AccountRow["platform"],
  organization_id = `org-${account_id}`,
): AccountRow => ({ account_id, platform, organization_id, account_name: account_id, currency: "BRL" });

describe("sincronização Windsor por conta", () => {
  it("ordena contas pela organização há mais tempo sem sincronizar e preserva empates", () => {
    const accounts = [
      account("act-newer-a", "meta_ads", "org-newer"),
      account("act-null-a", "meta_ads", "org-null"),
      account("act-old", "meta_ads", "org-old"),
      account("act-null-b", "meta_ads", "org-null"),
      account("act-newer-b", "meta_ads", "org-newer"),
    ];

    expect(orderAccountsByOldestOrganizationSync(accounts, [
      { organization_id: "org-newer", last_sync_succeeded_at: "2026-10-21T12:00:00.000Z" },
      { organization_id: "org-null", last_sync_succeeded_at: null },
      { organization_id: "org-old", last_sync_succeeded_at: "2026-10-20T12:00:00.000Z" },
    ]).map((item) => item.account_id)).toEqual([
      "act-null-a",
      "act-null-b",
      "act-old",
      "act-newer-a",
      "act-newer-b",
    ]);
  });

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

  it("mantém 90 dias no resumo e limita o detalhe Meta a 30 dias", async () => {
    const fetcher = vi.fn(async (
      _fields: readonly string[],
      _accountId: string,
      _platform: AccountRow["platform"],
      _period?: 30 | 90 | DateRange,
    ) => []);

    await fetchSelectedAccountRows([
      account("act_1", "meta_ads"),
      account("123-456-7890", "google_ads"),
    ], fetcher);

    const metaCalls = fetcher.mock.calls.filter((call) => call[1] === "act_1");
    expect(metaCalls).toHaveLength(5);
    expect(metaCalls[0]?.[3]).toBe(90);
    expect(metaCalls.slice(1).map((call) => call[3])).toEqual([30, 30, 30, 30]);
    expect(metaCalls.filter((call) => typeof call[3] === "object")).toHaveLength(0);
    expect(fetcher).toHaveBeenCalledWith(
      WINDSOR_SUMMARY_FIELDS_BY_PLATFORM.google_ads,
      "123-456-7890",
      "google_ads",
      90,
    );
  });

  it("quando o resumo Meta de 90 dias expira, junta três janelas de 30 dias", async () => {
    const timeout = Object.assign(
      new Error("Windsor não respondeu em 75 segundos."),
      { code: "windsor_timeout" },
    );
    const now = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-21T12:00:00.000Z"));
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    let activeWindows = 0;
    let peakWindows = 0;
    const fetcher = vi.fn(async (
      _fields: readonly string[],
      accountId: string,
      _platform: AccountRow["platform"],
      period?: 30 | 90 | DateRange,
    ) => {
      if (period === 90) throw timeout;
      if (typeof period === "object") {
        activeWindows += 1;
        peakWindows = Math.max(peakWindows, activeWindows);
        await Promise.resolve();
        activeWindows -= 1;
        return [{ account_id: accountId, date: period.from, spend: 1 }];
      }
      return [];
    });

    try {
      const result = (await fetchSelectedAccountRows([account("act_1", "meta_ads")], fetcher))
        .get("meta_ads:act_1");
      const ranges = fetcher.mock.calls
        .map((call) => call[3])
        .filter((period): period is DateRange => typeof period === "object");

      expect(ranges).toEqual([
        { from: "2026-07-24", to: "2026-08-22" },
        { from: "2026-08-23", to: "2026-09-21" },
        { from: "2026-09-22", to: "2026-10-21" },
      ]);
      expect(result?.rows).toHaveLength(3);
      expect(peakWindows).toBe(1);
      expect(warn).toHaveBeenCalledWith(
        "[windsor-dashboard] resumo de 90 dias dividido após timeout",
        { organization_id: "org-act_1", account_id: "act_1" },
      );
    } finally {
      now.mockRestore();
      warn.mockRestore();
    }
  });

  it("propaga o timeout quando uma janela do resumo também expira", async () => {
    const summaryTimeout = Object.assign(new Error("timeout do resumo"), { code: "windsor_timeout" });
    const windowTimeout = Object.assign(new Error("timeout da janela"), { code: "windsor_timeout" });
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    let windowsStarted = 0;
    const fetcher = vi.fn(async (
      _fields: readonly string[],
      accountId: string,
      _platform: AccountRow["platform"],
      period?: 30 | 90 | DateRange,
    ) => {
      if (period === 90) throw summaryTimeout;
      if (typeof period === "object") {
        windowsStarted += 1;
        if (windowsStarted === 2) throw windowTimeout;
        return [{ account_id: accountId, date: period.from, spend: 1 }];
      }
      return [];
    });

    try {
      const result = (await fetchSelectedAccountRows([account("act_1", "meta_ads")], fetcher))
        .get("meta_ads:act_1");

      expect(fetcher.mock.calls.filter((call) => typeof call[3] === "object")).toHaveLength(2);
      expect(result?.error).toBe(windowTimeout);
      expect(result?.error).toMatchObject({ code: "windsor_timeout" });
    } finally {
      warn.mockRestore();
    }
  });

  it("cobre exatamente 90 dias nas janelas, sem buraco nem sobreposição", async () => {
    const timeout = Object.assign(new Error("timeout do resumo"), { code: "windsor_timeout" });
    const now = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-21T12:00:00.000Z"));
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const fetcher = vi.fn(async (
      _fields: readonly string[],
      _accountId: string,
      _platform: AccountRow["platform"],
      period?: 30 | 90 | DateRange,
    ) => {
      if (period === 90) throw timeout;
      return [];
    });

    try {
      await fetchSelectedAccountRows([account("act_1", "meta_ads")], fetcher);
      const ranges = fetcher.mock.calls
        .map((call) => call[3])
        .filter((period): period is DateRange => typeof period === "object");
      const dayMs = 24 * 60 * 60 * 1_000;

      expect(ranges).toHaveLength(3);
      expect(ranges[0]?.from).toBe("2026-07-24");
      expect(ranges[2]?.to).toBe("2026-10-21");
      expect(ranges.every((range) =>
        (Date.parse(range.to) - Date.parse(range.from)) / dayMs + 1 === 30,
      )).toBe(true);
      expect(ranges.slice(1).every((range, index) =>
        Date.parse(range.from) - Date.parse(ranges[index]?.to ?? "") === dayMs,
      )).toBe(true);
    } finally {
      now.mockRestore();
      warn.mockRestore();
    }
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

  it("repete timeout uma vez e não entra em laço", async () => {
    const timeout = Object.assign(
      new Error("Windsor não respondeu em 75 segundos."),
      { code: "windsor_timeout" },
    );
    const fetcher = vi.fn().mockRejectedValue(timeout);

    const results = await fetchSelectedAccountRows([
      account("123-456-7890", "google_ads"),
    ], fetcher);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(results.get("google_ads:123-456-7890")?.error).toBe(timeout);
  });

  it("não repete timeout quando o prazo global acabou durante a tentativa", async () => {
    const deadlineAt = Date.now() + 1_000;
    const timeout = Object.assign(
      new Error("Windsor não respondeu em 75 segundos."),
      { code: "windsor_timeout" },
    );
    const now = vi.spyOn(Date, "now");
    now.mockReturnValueOnce(deadlineAt - 1).mockReturnValue(deadlineAt);
    const fetcher = vi.fn().mockRejectedValue(timeout);

    const results = await fetchSelectedAccountRows([
      account("123-456-7890", "google_ads"),
    ], fetcher, deadlineAt);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(results.get("google_ads:123-456-7890")?.error).toBe(timeout);
    now.mockRestore();
  });

  it("não troca o último erro real por deadline de conta que nem foi tentada", () => {
    expect(configUpdateForSyncFailure({
      code: "windsor_sync_deadline",
      message: "windsor_sync_deadline",
    })).toEqual({ sync_status: "failed" });
    expect(configUpdateForSyncFailure({
      code: "windsor_sync_failed",
      message: "falha real",
    })).toEqual({ sync_status: "failed", last_sync_error: "falha real" });
  });

  it("combina métricas fragmentadas e miniatura sem data pelo anúncio", async () => {
    const fetcher = vi.fn(async (fields: readonly string[]) => {
      if (fields.includes("thumbnail_url")) {
        return [{
          account_id: "act_1",
          ad_id: "ad-1",
          ad_name: "Anúncio",
          thumbnail_url: "https://external-fra3-1.xx.fbcdn.net/emg1/v/t13/123?utld=cliente.test",
          effective_instagram_media__media_url: "https://scontent.cdninstagram.com/criativo.jpg",
        }];
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
      effective_instagram_media__media_url: "https://scontent.cdninstagram.com/criativo.jpg",
    });
  });

  it("não envia campos exclusivos de Meta ao Google Ads", () => {
    expect(WINDSOR_FIELDS_BY_PLATFORM.google_ads).toContain("conversion_value");
    expect(WINDSOR_FIELDS_BY_PLATFORM.google_ads).not.toContain("thumbnail_url");
    expect(WINDSOR_FIELDS_BY_PLATFORM.meta_ads).toContain("thumbnail_url");
    expect(WINDSOR_FIELDS_BY_PLATFORM.meta_ads).toContain("effective_instagram_media__media_url");
    expect(WINDSOR_FIELDS_BY_PLATFORM.meta_ads).toContain("ad_id");
    expect(WINDSOR_SUMMARY_FIELDS_BY_PLATFORM.meta_ads).not.toContain("ad_id");
    expect(WINDSOR_SUMMARY_FIELDS_BY_PLATFORM.meta_ads).not.toContain("effective_instagram_media__media_url");
    expect(WINDSOR_SUMMARY_FIELDS_BY_PLATFORM.meta_ads).not.toContain("website_destination_url");
    expect(WINDSOR_SUMMARY_FIELDS_BY_PLATFORM.meta_ads).toContain("adset_id");
    expect(WINDSOR_FIELDS_BY_PLATFORM.meta_ads).toContain("campaign_daily_budget");
    expect(WINDSOR_FIELDS_BY_PLATFORM.meta_ads).toContain("actions_landing_page_view");
    expect(WINDSOR_FIELDS_BY_PLATFORM.meta_ads).toContain("actions_add_to_cart");
    expect(WINDSOR_FIELDS_BY_PLATFORM.meta_ads).toContain("campaign_effective_status");
    expect(WINDSOR_FIELDS_BY_PLATFORM.meta_ads).toContain("website_destination_url");
    expect(WINDSOR_FIELDS_BY_PLATFORM.google_ads).toContain("campaign_status");
    expect(WINDSOR_FIELDS_BY_PLATFORM.google_ads).toContain("ad_final_urls");
  });
});
