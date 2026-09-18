"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { IntegrationAccessMap } from "@/lib/integrations/types";
import { useT } from "@/hooks/i18n/useT";

interface WorkflowOption {
  id: string;
  name: string;
  active: boolean;
  assigned_organization_id: string | null;
}

interface Payload {
  permissions: IntegrationAccessMap;
  whatsapp: { configured: boolean; status?: string; display_name?: string | null };
  windsor: { enabled: boolean; sync_status: string; last_sync_succeeded_at: string | null };
  n8n: { configured: boolean; workflows: WorkflowOption[]; assigned_workflow_ids: string[] };
}

export function IntegrationsClient({ organizationId }: { organizationId: string }) {
  const t = useT();
  const [data, setData] = useState<Payload | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/v1/admin/tenants/${organizationId}/integrations`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((payload) => setData(payload.data as Payload))
      .catch(() => toast.error("Não foi possível carregar as integrações."));
  }, [organizationId]);

  function permission(integration: keyof IntegrationAccessMap, field: "client_visible" | "client_can_reconnect", checked: boolean) {
    setData((current) => current ? {
      ...current,
      permissions: {
        ...current.permissions,
        [integration]: { ...current.permissions[integration], [field]: checked },
      },
    } : current);
  }

  function workflow(workflowId: string, checked: boolean) {
    setData((current) => current ? {
      ...current,
      n8n: {
        ...current.n8n,
        assigned_workflow_ids: checked
          ? [...new Set([...current.n8n.assigned_workflow_ids, workflowId])]
          : current.n8n.assigned_workflow_ids.filter((id) => id !== workflowId),
      },
    } : current);
  }

  async function save() {
    if (!data) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/v1/admin/tenants/${organizationId}/integrations`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permissions: data.permissions, workflow_ids: data.n8n.assigned_workflow_ids }),
      });
      if (!response.ok) throw new Error();
      toast.success("Integrações salvas.");
    } catch {
      toast.error("Não foi possível salvar as integrações.");
    } finally {
      setSaving(false);
    }
  }

  if (!data) return <p className="text-sm text-muted-foreground">{t("Carregando integrações...")}</p>;

  const cards: Array<{ id: keyof IntegrationAccessMap; title: string; state: string }> = [
    { id: "whatsapp", title: "WhatsApp", state: data.whatsapp.configured ? (data.whatsapp.status ?? "Configurado") : "Não configurado" },
    { id: "windsor", title: "Windsor", state: data.windsor.enabled ? data.windsor.sync_status : "Não configurado" },
    { id: "n8n", title: "n8n", state: data.n8n.configured ? `${data.n8n.workflows.length} workflows encontrados` : "Variáveis ausentes ou API indisponível" },
  ];

  return <div className="space-y-6">
    <div>
      <h2 className="text-xl font-semibold">{t("Integrações da organização")}</h2>
      <p className="text-sm text-muted-foreground">{t("O cliente só enxerga o que você liberar aqui.")}</p>
    </div>
    <div className="grid gap-4 lg:grid-cols-3">
      {cards.map((card) => <Card key={card.id}>
        <CardHeader><CardTitle className="text-base">{card.title}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{t(card.state)}</p>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={data.permissions[card.id].client_visible}
              onChange={(event) => permission(card.id, "client_visible", event.target.checked)} />
            {t("Cliente pode ver")}
          </label>
          {card.id === "whatsapp" ? <label className="flex items-center gap-2 text-sm">
            <input type="checkbox"
              disabled={!data.permissions.whatsapp.client_visible}
              checked={data.permissions.whatsapp.client_can_reconnect}
              onChange={(event) => permission("whatsapp", "client_can_reconnect", event.target.checked)} />
            {t("Cliente pode gerar QR de reconexão")}
          </label> : null}
        </CardContent>
      </Card>)}
    </div>
    <Card>
      <CardHeader><CardTitle className="text-base">{t("Workflows n8n desta organização")}</CardTitle></CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2">
        {data.n8n.workflows.length === 0 ? <p className="text-sm text-muted-foreground">{t("Nenhum workflow disponível.")}</p> : null}
        {data.n8n.workflows.map((item) => {
          const assignedElsewhere = Boolean(item.assigned_organization_id && item.assigned_organization_id !== organizationId);
          return <label key={item.id} className="flex items-start gap-2 rounded-md border p-3 text-sm">
            <input type="checkbox" disabled={assignedElsewhere}
              checked={data.n8n.assigned_workflow_ids.includes(item.id)}
              onChange={(event) => workflow(item.id, event.target.checked)} />
            <span><span className="block font-medium">{item.name}</span>
              <span className="text-xs text-muted-foreground">{t(item.active ? "Ativo" : "Inativo")}{assignedElsewhere ? t(" · já atribuído") : ""}</span>
            </span>
          </label>;
        })}
      </CardContent>
    </Card>
    <Button onClick={save} disabled={saving}>{t(saving ? "Salvando..." : "Salvar liberações")}</Button>
  </div>;
}
