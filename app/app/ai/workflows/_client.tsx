"use client";

import { useEffect, useState } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { N8nWorkflowView } from "@/lib/n8n/sanitize";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";

export function WorkflowsClient() {
  const t = useT();
  const tagDoIdioma = useTagDeIdioma();
  const [workflows, setWorkflows] = useState<N8nWorkflowView[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch("/api/v1/integrations/n8n/workflows", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((payload) => setWorkflows(payload.data.workflows as N8nWorkflowView[]))
      .catch(() => setFailed(true));
  }, []);

  if (failed) return <div className="p-6"><p className="text-sm text-destructive">{t("Não foi possível carregar os workflows agora.")}</p></div>;
  if (!workflows) return <div className="p-6"><p className="text-sm text-muted-foreground">{t("Carregando workflows...")}</p></div>;

  return <div className="space-y-6 p-4 sm:p-6">
    <header>
      <h1 className="text-2xl font-semibold tracking-tight">n8n</h1>
      <p className="text-sm text-muted-foreground">{t("Fluxos liberados pelo administrador. Esta visualização não permite editar nem executar.")}</p>
    </header>
    {workflows.length === 0 ? <p className="rounded-xl border p-6 text-sm text-muted-foreground">{t("Nenhum workflow foi liberado para esta organização.")}</p> : null}
    {workflows.map((workflow) => {
      const nodes: Node[] = workflow.nodes.map((node) => ({
        id: node.id,
        position: { x: node.position[0], y: node.position[1] },
        data: { label: node.name },
        draggable: false,
        connectable: false,
        selectable: false,
        style: { width: 190, borderRadius: 10, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))" },
      }));
      const edges: Edge[] = workflow.edges;
      return <Card key={workflow.id}>
        <CardHeader className="flex-row items-center justify-between gap-3">
          <CardTitle className="text-base">{workflow.name}</CardTitle>
          <span className="text-xs text-muted-foreground">{t(workflow.active ? "Ativo" : "Inativo")}</span>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="h-[420px] overflow-hidden rounded-lg border" aria-label={`Fluxo ${workflow.name}`}>
            <ReactFlow nodes={nodes} edges={edges} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} fitView>
              <Background />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>
          <div>
            <h3 className="mb-2 text-sm font-medium">{t("Últimas execuções")}</h3>
            {workflow.executions.length === 0 ? <p className="text-sm text-muted-foreground">{t("Sem execuções recentes.")}</p> :
              <ul className="divide-y rounded-md border">
                {workflow.executions.map((execution) => <li key={execution.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="font-medium">{execution.status}</span>
                  <time className="text-xs text-muted-foreground">{execution.started_at ? new Date(execution.started_at).toLocaleString(tagDoIdioma) : t("Horário indisponível")}</time>
                </li>)}
              </ul>}
          </div>
        </CardContent>
      </Card>;
    })}
  </div>;
}
