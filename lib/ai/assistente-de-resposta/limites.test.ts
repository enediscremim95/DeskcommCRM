import { describe, expect, it, vi } from "vitest";

import { verificarLimitesDoAssistente } from "./limites";

describe("limites do assistente de resposta", () => {
  it("conta por organização em janelas de hora e dia", async () => {
    const count = vi.fn(async (_bucket: string, limit: number, seconds: number) => ({
      allowed: true,
      count: 1,
      limit,
      window_sec: seconds,
    }));
    await expect(
      verificarLimitesDoAssistente(
        "org-sintetica",
        { hourly_limit: 7, daily_limit: 30 },
        count,
      ),
    ).resolves.toEqual({ allowed: true });
    expect(count.mock.calls).toEqual([
      ["reply-assistant:hour:org-sintetica", 7, 3_600],
      ["reply-assistant:day:org-sintetica", 30, 86_400],
    ]);
  });

  it("interrompe antes da geração quando o teto é atingido", async () => {
    const count = vi.fn(async (_bucket: string, limit: number, seconds: number) => ({
      allowed: false,
      count: limit + 1,
      limit,
      window_sec: seconds,
    }));
    const result = await verificarLimitesDoAssistente(
      "org-sintetica",
      { hourly_limit: 1, daily_limit: 10 },
      count,
    );
    expect(result).toMatchObject({
      allowed: false,
      code: "reply_assistant_hourly_limit",
    });
    expect(count).toHaveBeenCalledTimes(1);
  });
});
