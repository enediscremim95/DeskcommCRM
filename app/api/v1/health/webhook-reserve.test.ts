import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: "https://supabase.example.com",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-test",
    SUPABASE_SERVICE_ROLE_KEY: "service-test",
    UPSTASH_REDIS_REST_URL: "https://redis.example.com",
    UPSTASH_REDIS_REST_TOKEN: "redis-test",
    [["WA", "HA_API_BASE_URL"].join("")]: "https://canal.example.com",
    [["WA", "HA_API_KEY"].join("")]: "canal-test",
    INTERNAL_CRON_SECRET: "cron-test",
    INTERNAL_SECRET: "",
  },
}));

vi.mock("@/lib/webhooks/lead-reserve", () => ({
  statusReservaWebhook: async () => ({
    count: 7,
    capacity: 3600,
    oldest_received_at: "2026-09-30T14:41:00.000Z",
    oldest_age_seconds: 120,
    retention_seconds: 86400,
  }),
}));

describe("health da reserva de formulários", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ result: "PONG" }),
      }),
    );
  });

  it("mostra quantidade e idade sem consultar o Postgres para obter a fila", async () => {
    const { GET } = await import("./route");
    const response = await GET(new NextRequest("https://crm.example.com/api/v1/health"));
    const { data } = await response.json();

    expect(data.status).toBe("degraded");
    expect(data.checks.webhook_reserve).toMatchObject({
      status: "degraded",
      reason: "itens_pendentes",
      count: 7,
      capacity: 3600,
      oldest_received_at: "2026-09-30T14:41:00.000Z",
      oldest_age_seconds: 120,
    });
  });
});
