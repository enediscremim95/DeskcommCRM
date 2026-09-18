import {
  buildWindsorUrl,
  isTimeoutError,
  WINDSOR_REQUEST_TIMEOUT_MS,
} from "./request";
import { WINDSOR_FETCH_DEADLINE_MS } from "./account-fetch";
import { describe, expect, it } from "vitest";

describe("cliente Windsor por conta", () => {
  it("usa o conector da plataforma e select_accounts, sem pedir o /all", async () => {
    const url = buildWindsorUrl(
      "chave-de-teste",
      ["date", "account_id", "spend"],
      "last_90dT",
      undefined,
      { accountId: "act_123", platform: "meta_ads" },
    );
    expect(url.origin + url.pathname).toBe("https://connectors.windsor.ai/facebook");
    expect(url.searchParams.get("select_accounts")).toBe("act_123");
    expect(url.searchParams.get("account_id")).toBeNull();
    expect(url.searchParams.get("date_preset")).toBe("last_90dT");
  });

  it("reconhece o abort usado pelo fetch e mantém prazo menor que a janela do cron", () => {
    const timeout = new Error("segredo não deve atravessar");
    timeout.name = "TimeoutError";
    expect(isTimeoutError(timeout)).toBe(true);
    expect(WINDSOR_REQUEST_TIMEOUT_MS).toBe(75_000);
    expect(WINDSOR_FETCH_DEADLINE_MS + WINDSOR_REQUEST_TIMEOUT_MS).toBeLessThan(600_000);
  });

  it("consulta alcance agregado no intervalo sem dimensão diária", () => {
    const url = buildWindsorUrl(
      "chave-de-teste",
      ["account_id", "campaign_id", "campaign", "reach"],
      undefined,
      undefined,
      { accountId: "act_123", platform: "meta_ads" },
      { from: "2026-09-01", to: "2026-09-18" },
    );
    expect(url.searchParams.get("date_preset")).toBeNull();
    expect(url.searchParams.get("date_from")).toBe("2026-09-01");
    expect(url.searchParams.get("date_to")).toBe("2026-09-18");
    expect(url.searchParams.get("fields")).not.toContain("date");
  });
});
