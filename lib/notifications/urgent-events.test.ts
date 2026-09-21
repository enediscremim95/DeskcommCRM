import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { enqueueOverdueLeadTaskEvents } from "./urgent-events";

describe("enqueueOverdueLeadTaskEvents", () => {
  it("enfileira cada tarefa vencida uma vez e aceita a deduplicação do banco", async () => {
    const inserts = [{ error: null }, { error: { code: "23505", message: "duplicate" } }];
    const taskBuilder = {
      select: vi.fn(() => taskBuilder),
      eq: vi.fn(() => taskBuilder),
      in: vi.fn(() => taskBuilder),
      not: vi.fn(() => taskBuilder),
      lte: vi.fn(() => taskBuilder),
      limit: vi.fn(async () => ({
        data: [
          { id: "task-1", lead_id: "lead-1" },
          { id: "task-2", lead_id: "lead-2" },
        ],
        error: null,
      })),
    };
    const insert = vi.fn(async () => inserts.shift()!);
    const admin = {
      from: vi.fn((table: string) => (table === "crm_tasks" ? taskBuilder : { insert })),
    } as unknown as SupabaseClient;

    const result = await enqueueOverdueLeadTaskEvents(
      admin,
      "org-1",
      new Date("2026-09-21T12:00:00.000Z"),
    );

    expect(result).toEqual({ scanned: 2, enqueued: 1 });
    expect(insert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        organization_id: "org-1",
        event_type: "lead.action_required",
        entity_id: "lead-1",
        payload: { reason: "task_overdue", task_id: "task-1" },
        metadata: { email_dedupe_key: "task-overdue:task-1" },
      }),
    );
  });
});
