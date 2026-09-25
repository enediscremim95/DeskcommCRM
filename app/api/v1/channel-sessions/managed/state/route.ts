import { randomUUID } from "node:crypto";
import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { ManagedConnectorError, notifyManagedConnectorRecovered, readManagedConnectorState } from "@/lib/channels/managed-qr";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientCanViewIntegration } from "@/lib/integrations/access";

export const dynamic = "force-dynamic";
export async function POST() {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const auth = await requireRole("manager", { requestId, resource: "channel_sessions", allowPlatformAdmin: true });
  if (!auth.ok) return auth.response;
  const admin = createAdminClient();
  if (!(auth.user.is_platform_admin && !auth.user.support) && !(await clientCanViewIntegration(admin, auth.org.orgId, "whatsapp"))) {
    return fail("forbidden", "Integração não liberada para esta organização.", 403, { requestId });
  }
  try {
    const result = await readManagedConnectorState(admin, auth.org.orgId);
    let hook: { status: "skipped" | "success" | "failed"; error: string | null } = { status: "skipped", error: null };
    if (result.transitionedToOpen) {
      await audit({ action: "channel.managed_opened", actorUserId: auth.user.id, organizationId: auth.org.orgId,
        resourceType: "channel_session", resourceId: result.connector.id, requestId });
      hook = await notifyManagedConnectorRecovered(admin, auth.org.orgId);
      if (hook.status !== "skipped") await audit({
        action: hook.status === "success" ? "channel.managed_reconnect_hook_succeeded" : "channel.managed_reconnect_hook_failed",
        actorUserId: auth.user.id, organizationId: auth.org.orgId, resourceType: "channel_session",
        resourceId: result.connector.id, requestId,
      });
    }
    return ok({ ...result.connector, reconnect_hook: hook }, { requestId });
  } catch (error) {
    if (error instanceof ManagedConnectorError) return fail(error.code, "Não foi possível conferir o estado do WhatsApp.", error.status, { requestId });
    return fail("upstream_unavailable", "Não foi possível conferir o estado do WhatsApp.", 502, { requestId });
  }
}
