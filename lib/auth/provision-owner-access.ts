import { randomBytes, randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { audit } from "@/lib/audit";
import { issueInvite } from "@/lib/auth/issue-invite";
import { openOwnerPassword, sealOwnerPassword } from "@/lib/auth/owner-access-secret";
import { buildOwnerAccessEmail } from "@/lib/email/templates/owner-access";
import { marcaDaSaida } from "@/lib/branding/saida";
import { isEmailConfigured, sendEmail } from "@/lib/email/resend";
import { interfaceSettingsSchema } from "@/lib/navigation/interface";

export interface OwnerAccessResult {
  status: "sent" | "failed" | "existing_user" | "already_sent";
  login_url: string;
  retryable: boolean;
}

/** Retentativa nunca redefine senha: recupera somente o usuário que este pedido criou. */
export async function provisionOwnerAccess(input: {
  organizationId: string; actorId: string; requestId: string;
}): Promise<OwnerAccessResult> {
  const loginUrl = `${env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/login`;
  const result = (status: OwnerAccessResult["status"], retryable: boolean): OwnerAccessResult =>
    ({ status, retryable, login_url: loginUrl });
  const admin = createAdminClient();
  const lease = randomUUID();
  let claimed = false;
  let userId: string | null = null;
  const complete = async (status: string) => {
    const { data, error } = await admin.rpc("fn_complete_tenant_owner_access", {
      p_organization_id: input.organizationId, p_actor: input.actorId,
      p_lease: lease, p_user_id: userId, p_status: status,
    });
    if (error || data !== true) throw new Error("access_state_unavailable");
  };
  try {
    // Não cria uma conta sem ter sequer um remetente configurado.
    if (!isEmailConfigured()) return result("failed", true);
    // Atende também instalações que exigem as quatro classes de caracteres.
    const password = "Aa1!" + randomBytes(24).toString("base64url");
    const { data: access, error } = await admin.rpc("fn_claim_tenant_owner_access", {
      p_organization_id: input.organizationId, p_actor: input.actorId, p_lease: lease,
      p_encrypted_password: sealOwnerPassword(password, env.INTERNAL_SECRET, input.organizationId),
    });
    if (error || !access) return result("failed", true);
    if (access.status === "sent") return result("already_sent", false);
    if (access.status === "existing_user") return result("existing_user", false);
    if (access.status !== "claimed") return result("failed", true);
    claimed = true;
    userId = access.user_id;
    if (userId && !access.owned_user) {
      // Uma conta já existente conserva senha, MFA e vínculos; o titular aceita o convite.
      const invitation = await issueInvite({
        email: access.email, role: "admin",
        interfaceSettings: interfaceSettingsSchema.parse(access.owner_interface_settings),
        organizationId: input.organizationId, orgName: access.org_name,
        inviterId: input.actorId, inviterName: "Administrador", requestId: input.requestId,
      });
      await complete(invitation.email_dispatched ? "existing_user" : "failed");
      return result(invitation.email_dispatched ? "existing_user" : "failed", !invitation.email_dispatched);
    }
    const storedPassword = openOwnerPassword(access.encrypted_password, env.INTERNAL_SECRET, input.organizationId);
    if (!userId) {
      const { data, error: createError } = await admin.auth.admin.createUser({
        email: access.email, password: storedPassword, email_confirm: true,
        app_metadata: { crm_provisioning_org: input.organizationId },
      });
      // Inclui corrida com cadastro independente: próximo clique consulta a conta,
      // jamais updateUserById(password) ou associação por e-mail sem aceite.
      if (createError || !data.user) throw new Error("owner_creation_failed");
      userId = data.user.id;
    }
    await complete("linked");
    const marca = await marcaDaSaida(input.organizationId);
    const sent = await sendEmail({
      to: access.email, fromName: marca.nome,
      ...buildOwnerAccessEmail({ orgName: access.org_name, email: access.email,
        password: storedPassword, loginUrl, marca }),
      tags: [{ name: "kind", value: "owner_access" }, { name: "org", value: input.organizationId }],
    });
    await complete(sent.ok ? "sent" : "failed");
    await audit({
      action: "tenant.owner_access_dispatched", actorUserId: input.actorId,
      organizationId: input.organizationId, resourceType: "organization", resourceId: input.organizationId,
      actingAsPlatformAdmin: true, bypassedRls: true, requestId: input.requestId,
      metadata: { email_dispatched: sent.ok },
    });
    return result(sent.ok ? "sent" : "failed", !sent.ok);
  } catch {
    if (claimed) { try { await complete("failed"); } catch { /* A lease expira e libera nova tentativa. */ } }
    return result("failed", true);
  }
}
