import { randomUUID } from "node:crypto";
import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { mfaEmDivida } from "@/lib/auth/server";
import { ManagedConnectorError, requestManagedConnectorQr } from "@/lib/channels/managed-qr";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientCanReconnectWhatsapp } from "@/lib/integrations/access";

export const dynamic = "force-dynamic";
export async function POST() {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const auth = await requireRole("admin", { requestId, resource: "channel_sessions", allowPlatformAdmin: true });
  if (!auth.ok) return auth.response;
  const admin = createAdminClient();
  if (!(auth.user.is_platform_admin && !auth.user.support) && !(await clientCanReconnectWhatsapp(admin, auth.org.orgId))) {
    return fail("forbidden", "Reconexão por QR não liberada para esta organização.", 403, { requestId });
  }
  if (await mfaEmDivida()) return fail("mfa_required", "Confirme a verificação em duas etapas.", 403, { requestId });
  try {
    const data = await requestManagedConnectorQr(admin, auth.org.orgId);
    await audit({ action: "channel.managed_qr_requested", actorUserId: auth.user.id,
      organizationId: auth.org.orgId, resourceType: "channel_session", requestId,
      metadata: { attempt: data.attempts } });
    return ok(data, { requestId });
  } catch (error) {
    if (error instanceof ManagedConnectorError) {
      const headers = error.retryAfterSeconds ? { "Retry-After": String(error.retryAfterSeconds) } : undefined;
      const message = error.code === "managed_connector_qr_rate_limited"
        ? "Aguarde antes de gerar outro QR. O limite protege o número contra bloqueio."
        : error.code === "managed_connector_qr_attempts_exhausted"
          ? "As três tentativas de segurança foram usadas. Não gere novos pareamentos; acione o suporte."
          : "Não foi possível gerar o QR agora.";
      return fail(error.code, message, error.status, { requestId, headers });
    }
    return fail("upstream_unavailable", "Não foi possível gerar o QR agora.", 502, { requestId });
  }
}
