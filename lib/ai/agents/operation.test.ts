import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  assertCurrentServiceBoundary,
  StaleServiceBoundaryError,
} from "@/lib/atendimento/fronteira";
import type { CurrentServiceBoundary } from "@/lib/atendimento/fronteira";
import type { JobRow, Queryable } from "@/lib/agent-engine/queue/queue";
import { rescheduleStaleAgentOperation } from "@/lib/agent-engine/queue/stale-agent-operation";
import {
  assertAgentOperationPg,
  StaleAgentOperationError,
  type AgentOperationContext,
} from "./operation";

const boundary: CurrentServiceBoundary = {
  organization_id: "org",
  contact_id: "contact",
  conversation_id: "conversation",
  service_revision: 1,
  demanda_id: "demand",
  demanda_revision: 1,
  status: "open",
  demanda_fechada_em: null,
};

const operation: AgentOperationContext = {
  organizationId: "org",
  agentId: "agent",
  versionId: "version-1",
  revision: "7",
};

const sendMessageSource = readFileSync(
  join(process.cwd(), "lib/agent-engine/edge/crm/send-message.ts"),
  "utf8",
);
const workerSource = readFileSync(join(process.cwd(), "workers/agent-worker/main.ts"), "utf8");
const SPECIFIC_WORKER_BRANCH = "await rescheduleStaleAgentOperation(";
const GENERIC_WORKER_BRANCH =
  "const terminal = err instanceof StaleServiceBoundaryError || ehVetoPermanenteDeNegocio(err);";

function specificWorkerBranchComesFirst(source: string): boolean {
  const specific = source.indexOf(SPECIFIC_WORKER_BRANCH);
  const generic = source.indexOf(GENERIC_WORKER_BRANCH);
  return specific >= 0 && generic > specific;
}

function simulateSendMessageHandlerCatch(error: unknown): never {
  try {
    throw error;
  } catch (caught) {
    if (caught instanceof StaleServiceBoundaryError) throw caught;
    throw new Error(`handler de envio indisponível: ${String(caught)}`);
  }
}

function runningJob(): JobRow {
  return {
    id: "job",
    organization_id: "org",
    contact_id: "contact",
    kind: "inbound_turn",
    source_event_id: "event",
    payload: { service_boundary: boundary },
    status: "running",
    priority: 100,
    run_after: new Date("2026-11-05T00:00:00.000Z"),
    attempts: 1,
    max_attempts: 5,
    last_error: null,
    locked_by: "worker",
    locked_at: new Date("2026-11-05T00:00:00.000Z"),
    claim_acquired_at: "2026-11-05T00:00:00.000001Z",
    created_at: new Date("2026-11-05T00:00:00.000Z"),
  };
}

describe("mudança operacional durante o turno", () => {
  it("não falsifica a fronteira de atendimento e informa current versus expected", async () => {
    expect(() => assertCurrentServiceBoundary(boundary, boundary)).not.toThrow();
    const db = {
      query: vi.fn(async () => ({
        rows: [
          {
            published_version_id: "version-2",
            operation_revision: "8",
            operation_mode: "automatic",
            paused_at: null,
            archived_at: null,
          },
        ],
      })),
    } as unknown as Queryable;

    let failure: unknown;
    try {
      await assertAgentOperationPg(db, operation);
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(StaleAgentOperationError);
    expect(failure).toBeInstanceOf(StaleServiceBoundaryError);
    expect(failure).toMatchObject({
      reason: "published_version_changed",
      expected: { publishedVersionId: "version-1", revision: "7" },
      current: { publishedVersionId: "version-2", revision: "8" },
    });
    expect((failure as Error).message).toContain("expected_version=version-1");
    expect((failure as Error).message).toContain("current_version=version-2");
  });

  it("atravessa o catch do envio e o worker trata a classe específica antes da genérica", async () => {
    const error = new StaleAgentOperationError(
      "operation_revision_changed",
      {
        publishedVersionId: "version-1",
        revision: "7",
        mode: "automatic",
        paused: false,
        archived: false,
      },
      {
        publishedVersionId: "version-1",
        revision: "8",
        mode: "automatic",
        paused: false,
        archived: false,
      },
    );

    expect(sendMessageSource).toMatch(
      /err instanceof AgendaDeferredError \|\| err instanceof StaleServiceBoundaryError\) throw err/,
    );
    expect(() => simulateSendMessageHandlerCatch(error)).toThrow(error);

    expect(specificWorkerBranchComesFirst(workerSource)).toBe(true);
    const inverted = workerSource
      .replace(SPECIFIC_WORKER_BRANCH, "__SPECIFIC_BRANCH__")
      .replace(GENERIC_WORKER_BRANCH, SPECIFIC_WORKER_BRANCH)
      .replace("__SPECIFIC_BRANCH__", GENERIC_WORKER_BRANCH);
    expect(inverted).not.toBe(workerSource);
    expect(specificWorkerBranchComesFirst(inverted)).toBe(false);

    const job = runningJob();
    const query = vi.fn(async (_text: string, _values?: unknown[]) => ({ rows: [job] }));
    const propagated = (() => {
      try {
        simulateSendMessageHandlerCatch(error);
      } catch (caught) {
        return caught;
      }
    })();

    await expect(
      rescheduleStaleAgentOperation(
        { query } as unknown as Queryable,
        job,
        "worker",
        propagated,
        job.claim_acquired_at,
      ),
    ).resolves.toEqual({ reason: "operation_revision_changed", rescheduled: true });
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]?.[0]).toContain("status = 'pending'");
    expect(query.mock.calls[0]?.[0]).not.toContain("status = 'failed'");
  });

  it("devolve o mesmo job à fila sem consumir tentativa", async () => {
    const job = runningJob();
    const error = new StaleAgentOperationError(
      "operation_revision_changed",
      {
        publishedVersionId: "version-1",
        revision: "7",
        mode: "automatic",
        paused: false,
        archived: false,
      },
      {
        publishedVersionId: "version-1",
        revision: "8",
        mode: "automatic",
        paused: false,
        archived: false,
      },
    );
    const query = vi.fn(async (_text: string, _values?: unknown[]) => ({ rows: [job] }));
    const db = { query } as unknown as Queryable;

    await expect(
      rescheduleStaleAgentOperation(db, job, "worker", error, job.claim_acquired_at),
    ).resolves.toEqual({ reason: "operation_revision_changed", rescheduled: true });

    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]?.[0]).toContain("status = 'pending'");
    expect(query.mock.calls[0]?.[0]).toContain("attempts = greatest(attempts - 1, 0)");
    expect(query.mock.calls[0]?.[1]).toEqual([
      "job",
      "worker",
      1_000,
      error.message,
      job.claim_acquired_at,
    ]);
  });

  it("mantém a fronteira de atendimento realmente velha como veto permanente", async () => {
    const query = vi.fn();
    const error = new StaleServiceBoundaryError();
    const result = await rescheduleStaleAgentOperation(
      { query } as unknown as Queryable,
      runningJob(),
      "worker",
      error,
    );
    expect(error).not.toBeInstanceOf(StaleAgentOperationError);
    expect(workerSource).toContain(GENERIC_WORKER_BRANCH);
    expect(workerSource).toContain(
      "await cancelJob(pool, job.id, workerId, errMsg(err), claimOfJob(job)?.acquired_at);",
    );
    expect(result).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it("não reinicia sem uma versão publicada segura", async () => {
    const query = vi.fn();
    const error = new StaleAgentOperationError(
      "published_version_changed",
      {
        publishedVersionId: "version-1",
        revision: "7",
        mode: "automatic",
        paused: false,
        archived: false,
      },
      {
        publishedVersionId: null,
        revision: "8",
        mode: "automatic",
        paused: false,
        archived: false,
      },
    );
    const result = await rescheduleStaleAgentOperation(
      { query } as unknown as Queryable,
      runningJob(),
      "worker",
      error,
    );
    expect(error.terminal).toBe(true);
    expect(result).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
});
