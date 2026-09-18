import { randomUUID } from "node:crypto";
import { fail, ok } from "@/lib/api/wrappers";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { findManagedConnector } from "@/lib/channels/managed-qr";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientCanReconnectWhatsapp, clientCanViewIntegration } from "@/lib/integrations/access";

export const dynamic = "force-dynamic";
export async function GET() {
  const requestId = randomUUID();
  const user = await loadAuthUser();
  if (!user) return fail("unauthenticated", "Sessão expirada.", 401, { requestId });
  const org = await resolveActiveOrg(user);
  if (!org) return fail("forbidden_tenant", "Nenhuma organização ativa.", 403, { requestId });
  const admin = createAdminClient();
  if (!(user.is_platform_admin && !user.support) && !(await clientCanViewIntegration(admin, org.orgId, "whatsapp"))) {
    return fail("forbidden", "Integração não liberada para esta organização.", 403, { requestId });
  }
  try {
    const connector = await findManagedConnector(admin, org.orgId);
    const canReconnect = user.is_platform_admin && !user.support
      ? true
      : await clientCanReconnectWhatsapp(admin, org.orgId);
    return ok(connector ? { ...connector, client_can_reconnect: canReconnect } : null, { requestId });
  }
  catch { return fail("internal_error", "Não foi possível carregar o conector.", 500, { requestId }); }
}
