export interface N8nWorkflowSummary {
  id: string;
  name: string;
  active: boolean;
}

export interface N8nWorkflowNode {
  id: string;
  name: string;
  type: string;
  position: [number, number];
}

export interface N8nWorkflowEdge {
  id: string;
  source: string;
  target: string;
}

export interface N8nExecutionSummary {
  id: string;
  status: string;
  started_at: string | null;
  stopped_at: string | null;
}

export interface N8nWorkflowView extends N8nWorkflowSummary {
  nodes: N8nWorkflowNode[];
  edges: N8nWorkflowEdge[];
  executions: N8nExecutionSummary[];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function sanitizeWorkflowSummary(value: unknown): N8nWorkflowSummary | null {
  const row = record(value);
  const id = text(row.id);
  const name = text(row.name);
  if (!id || !name) return null;
  return { id, name, active: row.active === true };
}

export function sanitizeWorkflow(value: unknown): Omit<N8nWorkflowView, "executions"> | null {
  const row = record(value);
  const summary = sanitizeWorkflowSummary(row);
  if (!summary) return null;
  const rawNodes = Array.isArray(row.nodes) ? row.nodes : [];
  const nodes = rawNodes.flatMap((item): N8nWorkflowNode[] => {
    const node = record(item);
    const id = text(node.id);
    const name = text(node.name);
    const type = text(node.type);
    const rawPosition = Array.isArray(node.position) ? node.position : [];
    const x = typeof rawPosition[0] === "number" ? rawPosition[0] : 0;
    const y = typeof rawPosition[1] === "number" ? rawPosition[1] : 0;
    return id && name && type ? [{ id, name, type, position: [x, y] }] : [];
  });
  const idByName = new Map(nodes.map((node) => [node.name, node.id]));
  const edges: N8nWorkflowEdge[] = [];
  const connections = record(row.connections);
  for (const [sourceName, outputGroups] of Object.entries(connections)) {
    const source = idByName.get(sourceName);
    if (!source) continue;
    const main = record(outputGroups).main;
    if (!Array.isArray(main)) continue;
    main.forEach((group, outputIndex) => {
      if (!Array.isArray(group)) return;
      group.forEach((candidate, connectionIndex) => {
        const targetName = text(record(candidate).node);
        const target = idByName.get(targetName);
        if (!target) return;
        edges.push({ id: `${source}:${target}:${outputIndex}:${connectionIndex}`, source, target });
      });
    });
  }
  return { ...summary, nodes, edges };
}

export function sanitizeExecutions(value: unknown): N8nExecutionSummary[] {
  const rows = Array.isArray(record(value).data) ? (record(value).data as unknown[]) : [];
  return rows.flatMap((item): N8nExecutionSummary[] => {
    const row = record(item);
    const id = text(row.id);
    if (!id) return [];
    return [{
      id,
      status: text(row.status) || "unknown",
      started_at: text(row.startedAt) || null,
      stopped_at: text(row.stoppedAt) || null,
    }];
  });
}

export function n8nRecord(value: unknown): Record<string, unknown> {
  return record(value);
}
