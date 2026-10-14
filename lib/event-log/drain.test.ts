// @vitest-environment node
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { EVENT_LOG_MAX_ATTEMPTS, recoverStuckEvents } from "@/lib/event-log/drain";

describe("recoverStuckEvents", () => {
  it("move para dead um processing que já atingiu o teto de tentativas", async () => {
    const stale = {
      id: "evento-que-derrubou-o-processo",
      attempts: EVENT_LOG_MAX_ATTEMPTS,
      last_error: "falha anterior",
      updated_at: "2026-10-13T20:00:00.000Z",
    };
    const patches: Record<string, unknown>[] = [];

    const staleQuery = {
      eq: vi.fn().mockReturnThis(),
      lt: vi.fn(async () => ({ data: [stale], error: null })),
    };
    const updateQuery = {
      eq: vi.fn().mockReturnThis(),
      select: vi.fn(async () => ({ data: [{ id: stale.id }], error: null })),
    };
    const admin = {
      from: vi.fn(() => ({
        select: vi.fn(() => staleQuery),
        update: vi.fn((patch: Record<string, unknown>) => {
          patches.push(patch);
          return updateQuery;
        }),
      })),
    } as unknown as SupabaseClient;

    const summary = await recoverStuckEvents(admin, new Date("2026-10-13T20:30:00.000Z"));

    expect(summary).toEqual({ requeued: 0, dead: 1 });
    expect(patches).toHaveLength(1);
    expect(patches[0]).toMatchObject({
      status: "dead",
      attempts: EVENT_LOG_MAX_ATTEMPTS + 1,
      next_attempt_at: null,
    });
    expect(patches[0]?.last_error).toContain("derrubou o processo repetidamente");
  });
});
