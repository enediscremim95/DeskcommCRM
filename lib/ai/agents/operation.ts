import type { Queryable } from "@/lib/agent-engine/queue/queue";
import type { SupabaseClient } from "@supabase/supabase-js";
import { StaleServiceBoundaryError } from "@/lib/atendimento/fronteira";
export interface AgentOperationContext {
  organizationId: string;
  agentId: string;
  versionId: string;
  revision: string;
}

export type StaleAgentOperationReason =
  | "agent_missing"
  | "published_version_changed"
  | "operation_revision_changed"
  | "operation_mode_changed"
  | "agent_paused"
  | "agent_archived";

interface AgentOperationSnapshot {
  publishedVersionId: string | null;
  revision: string | null;
  mode: string | null;
  paused: boolean;
  archived: boolean;
}

/**
 * A configuração operacional mudou durante o turno. Isso não significa que a
 * fronteira do atendimento mudou: o mesmo job deve recomeçar com a configuração
 * atual, preservando a mensagem que pode ter sido coalescida nele pelo drain.
 */
export class StaleAgentOperationError extends StaleServiceBoundaryError {
  readonly reason: StaleAgentOperationReason;
  readonly expected: AgentOperationSnapshot;
  readonly current: AgentOperationSnapshot;
  readonly terminal: boolean;

  constructor(
    reason: StaleAgentOperationReason,
    expected: AgentOperationSnapshot,
    current: AgentOperationSnapshot,
  ) {
    super();
    this.message =
      `agent_operation_stale:${reason}` +
      ` expected_version=${expected.publishedVersionId ?? "missing"}` +
      ` current_version=${current.publishedVersionId ?? "missing"}` +
      ` expected_revision=${expected.revision ?? "missing"}` +
      ` current_revision=${current.revision ?? "missing"}` +
      ` current_mode=${current.mode ?? "missing"}` +
      ` paused=${current.paused} archived=${current.archived}`;
    this.name = "StaleAgentOperationError";
    this.reason = reason;
    this.expected = expected;
    this.current = current;
    // Sem agente executável não há configuração nova segura para retomar.
    // O worker trata esses casos como desligamento intencional, não como retry.
    this.terminal =
      reason === "agent_missing" ||
      reason === "agent_archived" ||
      current.publishedVersionId === null;
  }
}

type AgentOperationRow = {
  published_version_id: string | null;
  operation_revision: number | string;
  operation_mode: string;
  paused_at: string | null;
  archived_at: string | null;
};

function assert(row: AgentOperationRow | undefined | null, c: AgentOperationContext) {
  const expected: AgentOperationSnapshot = {
    publishedVersionId: c.versionId,
    revision: c.revision,
    mode: "automatic",
    paused: false,
    archived: false,
  };
  const current: AgentOperationSnapshot = row
    ? {
        publishedVersionId: row.published_version_id,
        revision: String(row.operation_revision),
        mode: row.operation_mode,
        paused: row.paused_at !== null,
        archived: row.archived_at !== null,
      }
    : {
        publishedVersionId: null,
        revision: null,
        mode: null,
        paused: false,
        archived: false,
      };

  let reason: StaleAgentOperationReason | null = null;
  if (!row) reason = "agent_missing";
  else if (row.published_version_id !== c.versionId) reason = "published_version_changed";
  else if (String(row.operation_revision) !== c.revision) reason = "operation_revision_changed";
  else if (row.operation_mode !== "automatic") reason = "operation_mode_changed";
  else if (row.paused_at) reason = "agent_paused";
  else if (row.archived_at) reason = "agent_archived";

  if (reason) throw new StaleAgentOperationError(reason, expected, current);
}
export async function assertAgentOperationPg(db: Queryable, c: AgentOperationContext) {
  const { rows } = await db.query<AgentOperationRow>(
    "select published_version_id,operation_revision::text,operation_mode,paused_at,archived_at from ai_agents where organization_id=$1 and id=$2",
    [c.organizationId, c.agentId],
  );
  assert(rows[0], c);
}
export async function assertAgentOperationSupabase(db: SupabaseClient, c: AgentOperationContext) {
  const { data, error } = await db
    .from("ai_agents")
    .select("published_version_id,operation_revision,operation_mode,paused_at,archived_at")
    .eq("organization_id", c.organizationId)
    .eq("id", c.agentId)
    .maybeSingle();
  if (error) throw error;
  assert(data, c);
}
