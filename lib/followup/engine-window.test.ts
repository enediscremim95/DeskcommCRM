import { expect, it, vi } from "vitest";
import { runFollowupTick, type AdminClient } from "./engine";
import type { EnrollmentRow } from "./node-handlers";

it("mantém a ação inscrita em um envio futuro, sem rechecks ou jobs extras", async () => {
  const now = new Date("2026-11-29T15:00:00Z");
  const abertura = "2026-11-30T12:00:00.000Z";
  const enrollment = {
    id: "enr", organization_id: "org", contact_id: "contact", version_id: "v1",
    current_node_id: "action", status: "active", steps_taken: 2,
  } as EnrollmentRow;
  const applyEnrollmentStep = vi.fn();
  const enqueueJob = vi.fn();
  const loadDeferredSend = vi.fn().mockResolvedValue(abertura);
  const db = {
    claimDueEnrollments: async () => [enrollment],
    loadFlowGraph: async () => ({
      nodes: [{ id: "action", type: "action", config: { mode: "text", body: "Olá!" } }],
      edges: [],
    }),
    loadLeadFacts: async () => ({ lead_stage: null, tags: [] }),
    loadEnrollmentEvents: async () => [
      { node_id: "action", event_type: "turn_enqueued", idempotency_key: "action:1", payload: { purpose: "send_message" } },
    ],
    applyEnrollmentStep,
    loadDeferredSend,
  } as unknown as AdminClient;

  expect(await runFollowupTick({ db, enqueueJob, clock: () => now })).toMatchObject({ scheduled: 1, advanced: 0, dead: 0 });
  expect(loadDeferredSend).toHaveBeenCalledWith(enrollment, "action:1", now);
  expect(applyEnrollmentStep).toHaveBeenCalledWith("enr", "org", {
    next_eval_at: abertura, claimed_until: null,
  }, expect.objectContaining({
    event_type: "send_deferred", node_id: "action", payload: { next_eval_at: abertura },
  }));
  expect(enqueueJob).not.toHaveBeenCalled();
});
