import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { findManagedConnector } from "@/lib/channels/managed-qr";
import { integrationAccessForOrganization } from "@/lib/integrations/access";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { listN8nWorkflows, N8nReadError, n8nIsConfigured } from "@/lib/n8n/client";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const idSchema = z.string().uuid();
const permissionSchema = z.object({
  client_visible: z.boolean(),
  client_can_reconnect: z.boolean().default(false),
});
const whatsappPermissionSchema = permissionSchema.extend({
  client_can_reconnect: z.boolean().default(true),
});
const inputSchema = z.object({
  permissions: z.object({
    whatsapp: whatsappPermissionSchema,
    n8n: permissionSchema,
    windsor: permissionSchema,
  }),
  workflow_ids: z.array(z.string().trim().min(1).max(200)).max(250),
});

async function platformAdmin() {
  try { return await requirePlatformAdmin(); } catch { return null; }
}

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();
  if (!(await platformAdmin())) return fail("forbidden", "Platform admin required", 403, { requestId });
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) return fail("validation_failed", "Organização inválida.", 422, { requestId });
  const admin = createAdminClient();
  const [permissions, connector, bindingsResult, trafficResult] = await Promise.all([
    integrationAccessForOrganization(admin, id),
    findManagedConnector(admin, id).catch(() => null),
    admin.from("n8n_workflow_bindings" as never)
      .select("organization_id,workflow_id")
      .order("workflow_id"),
    admin.from("traffic_dashboard_configs" as never)
      .select("enabled,sync_status,last_sync_succeeded_at")
      .eq("organization_id", id)
      .maybeSingle(),
  ]);
  if (bindingsResult.error || trafficResult.error) {
    return fail("internal_error", "Não foi possível carregar as integrações.", 500, { requestId });
  }
  let workflows: Array<{ id: string; name: string; active: boolean }> = [];
  let n8nAvailable = n8nIsConfigured();
  if (n8nAvailable) {
    try { workflows = await listN8nWorkflows(); }
    catch { n8nAvailable = false; }
  }
  const bindings = (bindingsResult.data ?? []) as unknown as Array<{
    organization_id: string;
    workflow_id: string;
  }>;
  const ownerByWorkflow = new Map(bindings.map((binding) => [binding.workflow_id, binding.organization_id]));
  return ok({
    permissions,
    whatsapp: connector ? { configured: true, status: connector.remote_state, display_name: connector.display_name } : { configured: false },
    windsor: trafficResult.data ?? { enabled: false, sync_status: "not_configured", last_sync_succeeded_at: null },
    n8n: {
      configured: n8nAvailable,
      workflows: workflows.map((workflow) => ({
        ...workflow,
        assigned_organization_id: ownerByWorkflow.get(workflow.id) ?? null,
      })),
      assigned_workflow_ids: bindings
        .filter((binding) => binding.organization_id === id)
        .map((binding) => binding.workflow_id),
    },
  }, { requestId });
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const adminContext = await platformAdmin();
  if (!adminContext) return fail("forbidden", "Platform admin required", 403, { requestId });
  const { id } = await context.params;
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!idSchema.safeParse(id).success || !parsed.success) {
    return fail("validation_failed", "Configuração inválida.", 422, {
      requestId,
      details: parsed.success ? undefined : parsed.error.flatten(),
    });
  }
  const selected = [...new Set(parsed.data.workflow_ids)];
  if (selected.length > 0) {
    if (!n8nIsConfigured()) return fail("service_unavailable", "n8n não configurado na instalação.", 503, { requestId });
    try {
      const validIds = new Set((await listN8nWorkflows()).map((workflow) => workflow.id));
      if (selected.some((workflowId) => !validIds.has(workflowId))) {
        return fail("validation_failed", "Há workflow que não existe mais no n8n.", 422, { requestId });
      }
    } catch (error) {
      const status = error instanceof N8nReadError && error.status === 503 ? 503 : 502;
      return fail("upstream_unavailable", "Não foi possível validar os workflows no n8n.", status, { requestId });
    }
  }
  const admin = createAdminClient();
  const { error } = await admin.rpc("fn_configure_organization_integrations" as never, {
    p_organization_id: id,
    p_actor: adminContext.user.id,
    p_permissions: parsed.data.permissions,
    p_workflow_ids: selected,
  } as never);
  if (error) {
    const conflict = error.code === "23505";
    return fail(
      conflict ? "workflow_already_assigned" : "internal_error",
      conflict ? "Um workflow já pertence a outra organização." : "Não foi possível salvar as integrações.",
      conflict ? 409 : 500,
      { requestId },
    );
  }
  await audit({
    action: "integrations.configuration_updated",
    actorUserId: adminContext.user.id,
    organizationId: id,
    resourceType: "organization_integrations",
    resourceId: id,
    requestId,
    bypassedRls: true,
    actingAsPlatformAdmin: true,
    metadata: { permissions: parsed.data.permissions, workflow_ids: selected },
  });
  return ok({ saved: true }, { requestId });
}
