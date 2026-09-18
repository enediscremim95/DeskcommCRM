import { describe, expect, it } from "vitest";

import { sanitizeExecutions, sanitizeWorkflow } from "@/lib/n8n/sanitize";

describe("projeção segura do n8n", () => {
  it("mantém só grafo e estado, sem parâmetros, credenciais, código ou payload", () => {
    const workflow = sanitizeWorkflow({
      id: "wf-1",
      name: "Atendimento",
      active: true,
      credentials: { segredo: "NAO_PODE_SAIR" },
      pinData: { payload: "NAO_PODE_SAIR" },
      nodes: [
        {
          id: "node-1",
          name: "Entrada",
          type: "webhook",
          position: [10, 20],
          parameters: { token: "NAO_PODE_SAIR" },
          credentials: { key: "NAO_PODE_SAIR" },
        },
        { id: "node-2", name: "Saída", type: "http", position: [200, 20], parameters: { code: "NAO_PODE_SAIR" } },
      ],
      connections: { Entrada: { main: [[{ node: "Saída", type: "main", index: 0 }]] } },
    });
    const executions = sanitizeExecutions({
      data: [{
        id: "exec-1",
        status: "success",
        startedAt: "2026-09-18T10:00:00Z",
        stoppedAt: "2026-09-18T10:00:01Z",
        data: { resultData: "NAO_PODE_SAIR" },
        workflowData: { nodes: "NAO_PODE_SAIR" },
      }],
    });

    expect(workflow).toEqual({
      id: "wf-1",
      name: "Atendimento",
      active: true,
      nodes: [
        { id: "node-1", name: "Entrada", type: "webhook", position: [10, 20] },
        { id: "node-2", name: "Saída", type: "http", position: [200, 20] },
      ],
      edges: [{ id: "node-1:node-2:0:0", source: "node-1", target: "node-2" }],
    });
    expect(executions).toEqual([{
      id: "exec-1",
      status: "success",
      started_at: "2026-09-18T10:00:00Z",
      stopped_at: "2026-09-18T10:00:01Z",
    }]);
    expect(JSON.stringify({ workflow, executions })).not.toContain("NAO_PODE_SAIR");
  });
});
