import { describe, expect, it, vi } from "vitest";

import {
  drenarReservaComRedis,
  enfileirarWebhookComRedis,
  novoItemDaReserva,
  WEBHOOK_RESERVE_MAX_ITEMS,
} from "@/lib/webhooks/lead-reserve";

class FakeRedis {
  queue = new Map<string, number>();
  strings = new Map<string, unknown>();

  async eval(script: string, keys: string[], args: Array<string | number>): Promise<unknown> {
    if (script.includes("ZADD")) {
      const cutoff = Number(args[0]);
      for (const [member, score] of this.queue) if (score <= cutoff) this.queue.delete(member);
      if (this.queue.size >= Number(args[1])) return [0, this.queue.size];
      this.queue.set(String(args[3]), Number(args[2]));
      return [1, this.queue.size];
    }
    if (script.includes("WITHSCORES")) {
      const cutoff = Number(args[0]);
      for (const [member, score] of this.queue) if (score <= cutoff) this.queue.delete(member);
      const oldest = [...this.queue.values()].sort((a, b) => a - b)[0] ?? 0;
      return [this.queue.size, oldest];
    }
    if (script.includes("GET")) {
      if (this.strings.get(keys[0]!) === args[0]) this.strings.delete(keys[0]!);
      return 1;
    }
    throw new Error("script inesperado");
  }

  async get<T>(key: string): Promise<T | null> {
    return (this.strings.get(key) as T | undefined) ?? null;
  }

  async set(key: string, value: unknown, options?: Record<string, unknown>): Promise<unknown> {
    if (options?.nx && this.strings.has(key)) return null;
    this.strings.set(key, value);
    return "OK";
  }

  async del(...keys: string[]): Promise<number> {
    let removed = 0;
    for (const key of keys) removed += this.strings.delete(key) ? 1 : 0;
    return removed;
  }

  async zrange<T = string>(_key: string, start: number, stop: number): Promise<T[]> {
    return [...this.queue.entries()]
      .sort((a, b) => a[1] - b[1])
      .slice(start, stop + 1)
      .map(([member]) => member as T);
  }

  async zrem(_key: string, ...members: string[]): Promise<number> {
    let removed = 0;
    for (const member of members) removed += this.queue.delete(member) ? 1 : 0;
    return removed;
  }
}

function item() {
  return novoItemDaReserva({
    id: "55555555-5555-4555-8555-555555555555",
    receivedAt: "2026-09-30T14:00:00.000Z",
    token: "token-da-fonte-123",
    organizationId: "66666666-6666-4666-8666-666666666666",
    sourceId: "77777777-7777-4777-8777-777777777777",
    rawBody: JSON.stringify({ nome: "Ana" }),
    contentType: "application/json",
    signature: null,
    origin: null,
    referer: null,
    userAgent: null,
    forwardedFor: null,
  });
}

describe("dreno da reserva de leads", () => {
  it("repetir o mesmo item cria um único lead na organização certa", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-30T14:01:00.000Z"));
    try {
      const redis = new FakeRedis();
      const reserved = item();
      await enfileirarWebhookComRedis(redis, reserved, Date.now());

      const leads = new Map<string, { organizationId: string }>();
      let primeiraRodada = true;
      const processar = async (queued: typeof reserved) => {
        const key = `${queued.organizationId}:${queued.externalId}`;
        if (!leads.has(key)) leads.set(key, { organizationId: queued.organizationId });
        if (primeiraRodada) {
          primeiraRodada = false;
          return false; // simula queda depois do INSERT e antes do ZREM
        }
        return true;
      };

      const primeira = await drenarReservaComRedis(redis, processar);
      const segunda = await drenarReservaComRedis(redis, processar);

      expect(primeira.drained).toBe(0);
      expect(segunda.drained).toBe(1);
      expect(leads.size).toBe(1);
      expect([...leads.values()][0]).toEqual({ organizationId: reserved.organizationId });
      expect(redis.queue.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("o teto calculado recusa o próximo item de forma explícita", async () => {
    const redis = new FakeRedis();
    for (let i = 0; i < WEBHOOK_RESERVE_MAX_ITEMS; i += 1) {
      redis.queue.set(`ocupado-${i}`, Date.parse("2026-09-30T14:00:00Z"));
    }

    const result = await enfileirarWebhookComRedis(
      redis,
      item(),
      Date.parse("2026-09-30T14:01:00Z"),
    );

    expect(result).toEqual({ status: "cheia", count: WEBHOOK_RESERVE_MAX_ITEMS });
    expect(redis.queue.size).toBe(WEBHOOK_RESERVE_MAX_ITEMS);
  });
});
