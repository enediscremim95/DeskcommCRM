import { randomUUID } from "node:crypto";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { clientCanViewIntegration } from "@/lib/integrations/access";
import { N8nReadError, readN8nWorkflow } from "@/lib/n8n/client";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const requestId = randomUUID();
  const auth = await requireRole("manager", { requestId, resource: "n8n_workflows", allowPlatformAdmin: true });
  if (!auth.ok) return auth.response;
  const admin = createAdminClient();
  if (
    !(auth.user.is_platform_admin && !auth.user.support) &&
    !(await clientCanViewIntegration(admin, auth.org.orgId, "n8n"))
  ) return fail("forbidden", "n8n não liberado para esta organização.", 403, { requestId });

  const { data, error } = await admin
    .from("n8n_workflow_bindings" as never)
    .select("workflow_id")
    .eq("organization_id", auth.org.orgId)
    .order("workflow_id");
  if (error) return fail("internal_error", "Não foi possível carregar os workflows.", 500, { requestId });
  const workflowIds = (data ?? []).map((row) => (row as { workflow_id: string }).workflow_id);
  try {
    const workflows = await Promise.all(workflowIds.map(readN8nWorkflow));
    return ok({ workflows }, { requestId });
  } catch (error) {
    const status = error instanceof N8nReadError && error.status === 503 ? 503 : 502;
    return fail("upstream_unavailable", "Não foi possível ler os workflows no n8n.", status, { requestId });
  }
}
