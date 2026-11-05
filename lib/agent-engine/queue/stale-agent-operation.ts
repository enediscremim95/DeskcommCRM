import { StaleAgentOperationError } from "@/lib/ai/agents/operation";
import { rescheduleJob, type JobRow, type Queryable } from "./queue";

const RESTART_DELAY_MS = 1_000;

export interface StaleAgentOperationDisposition {
  reason: string;
  rescheduled: boolean;
}

/**
 * Reinicia o mesmo job com a configuração atual do agente. O drain pode ter
 * coalescido a mensagem inbound mais nova neste job, portanto descartá-lo não é
 * seguro. A tentativa é devolvida porque mudança operacional não é falha.
 */
export async function rescheduleStaleAgentOperation(
  db: Queryable,
  job: JobRow,
  workerId: string,
  error: unknown,
  acquiredAt?: string,
): Promise<StaleAgentOperationDisposition | null> {
  if (!(error instanceof StaleAgentOperationError) || error.terminal) return null;
  const rescheduled = await rescheduleJob(db, job.id, workerId, {
    delayMs: RESTART_DELAY_MS,
    reason: error.message,
    ...(acquiredAt !== undefined ? { acquiredAt } : {}),
  });
  return { reason: error.reason, rescheduled: rescheduled !== null };
}
