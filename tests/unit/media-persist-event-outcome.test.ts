import { describe, expect, it } from "vitest";

import { drainEventLog } from "@/lib/event-log/drain";
import { registerHandler, type EventRow } from "@/lib/event-log/dispatcher";

const EVENTO: EventRow = {
  id: "evento-midia-1",
  organization_id: "org-1",
  event_type: "media.persist_requested",
  entity_kind: "message",
  entity_id: "msg-1",
  payload: { message_id: "msg-1" },
  metadata: {},
  consumed_by: [],
  attempts: 4,
  created_at: "2026-09-28T12:00:00.000Z",
};

describe("desfecho do evento de persistência de mídia", () => {
  it("uma falha definitiva do worker vira dead e nunca é marcada done", async () => {
    const updates: Array<Record<string, unknown>> = [];

    registerHandler({
      key: "media_persist_v1",
      events: ["media.persist_requested"],
      handle: async () => ({
        consumer_key: "media_persist_v1",
        status: "error",
        detail: "media_url ausente",
      }),
    });

    const admin = {
      from: () => ({
        select: () => {
          const query = {
            eq: () => query,
            or: () => query,
            in: () => query,
            order: () => query,
            limit: async () => ({ data: [EVENTO], error: null }),
          };
          return query;
        },
        update: (patch: Record<string, unknown>) => {
          updates.push(patch);
          let consultaDePresos = false;
          const query = {
            eq: () => query,
            lt: () => {
              consultaDePresos = true;
              return query;
            },
            select: async () => ({
              data: consultaDePresos ? [] : [{ id: EVENTO.id }],
              error: null,
            }),
          };
          return query;
        },
      }),
    };

    const summary = await drainEventLog(admin as never);
    const desfecho = updates.find((patch) => patch.attempts === 5);

    expect(summary).toEqual(expect.objectContaining({ done: 0, failed: 0, dead: 1 }));
    expect(desfecho).toEqual(
      expect.objectContaining({
        status: "dead",
        attempts: 5,
        consumed_by: [],
        last_error: "media_persist_v1: media_url ausente",
      }),
    );
    expect(updates).not.toContainEqual(expect.objectContaining({ status: "done" }));
  });
});
