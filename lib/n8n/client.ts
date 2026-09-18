import "server-only";

import { env } from "@/lib/env";
import {
  n8nRecord,
  sanitizeExecutions,
  sanitizeWorkflow,
  sanitizeWorkflowSummary,
  type N8nWorkflowSummary,
  type N8nWorkflowView,
} from "./sanitize";

export type {
  N8nExecutionSummary,
  N8nWorkflowEdge,
  N8nWorkflowNode,
  N8nWorkflowSummary,
  N8nWorkflowView,
} from "./sanitize";

const REQUEST_TIMEOUT_MS = 10_000;

export class N8nReadError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
    this.name = "N8nReadError";
  }
}

export function n8nIsConfigured(): boolean {
  return Boolean(env.N8N_BASE_URL.trim() && env.N8N_API_KEY.trim());
}

async function n8nGet(path: string): Promise<unknown> {
  if (!n8nIsConfigured()) throw new N8nReadError("n8n_not_configured", 503);
  const base = env.N8N_BASE_URL.replace(/\/+$/, "");
  const response = await fetch(`${base}/api/v1${path}`, {
    method: "GET",
    headers: { "X-N8N-API-KEY": env.N8N_API_KEY },
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new N8nReadError("n8n_read_failed", response.status);
  return response.json();
}

export async function listN8nWorkflows(): Promise<N8nWorkflowSummary[]> {
  const payload = n8nRecord(await n8nGet("/workflows?limit=250"));
  const rows = Array.isArray(payload.data) ? payload.data : [];
  return rows.flatMap((row) => {
    const workflow = sanitizeWorkflowSummary(row);
    return workflow ? [workflow] : [];
  });
}

export async function readN8nWorkflow(workflowId: string): Promise<N8nWorkflowView> {
  const safeId = encodeURIComponent(workflowId);
  const [workflowPayload, executionsPayload] = await Promise.all([
    n8nGet(`/workflows/${safeId}`),
    n8nGet(`/executions?workflowId=${safeId}&limit=10&includeData=false`),
  ]);
  const workflow = sanitizeWorkflow(workflowPayload);
  if (!workflow) throw new N8nReadError("n8n_invalid_workflow");
  return { ...workflow, executions: sanitizeExecutions(executionsPayload) };
}
