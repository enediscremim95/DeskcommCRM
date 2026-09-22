import { randomUUID } from "node:crypto";

import { audit } from "@/lib/audit";
import { marcaDaSaida } from "@/lib/branding/saida";
import { env } from "@/lib/env";
import { sendEmail } from "@/lib/email/resend";
import { buildInviteEmail } from "@/lib/email/templates/invite";
import type { Idioma } from "@/lib/i18n/idiomas";
import type { InterfaceSettings } from "@/lib/navigation/interface";
import type { Role } from "@/lib/schemas/team";
import { createAdminClient } from "@/lib/supabase/admin";

import { generateProvisionalPassword } from "./provisional-password";

export type ProvisionTeamAccessResult =
  | { ok: true; email: string; inviteId: string; loginUrl: string }
  | {
      ok: false;
      reason: "existing_user" | "create_failed" | "membership_failed" | "email_failed";
    };

export async function provisionTeamAccess(input: {
  email: string;
  role: Role;
  interfaceSettings: InterfaceSettings;
  organizationId: string;
  orgName: string;
  inviterId: string;
  requestId: string;
  idioma: Idioma;
}): Promise<ProvisionTeamAccessResult> {
  const admin = createAdminClient();
  const email = input.email.trim().toLowerCase();
  const password = generateProvisionalPassword();
  const inviteId = randomUUID();
  const issuedAt = new Date().toISOString();
  const loginUrl = `${env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/login`;
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { locale: input.idioma },
    app_metadata: { crm_provisioning_org: input.organizationId },
  });

  if (createError || !created.user) {
    return {
      ok: false,
      reason: createError?.status === 422 ? "existing_user" : "create_failed",
    };
  }

  const userId = created.user.id;
  const { data: membership, error: membershipError } = await admin.rpc("fn_accept_team_invite", {
    p_interface_settings: input.interfaceSettings,
    p_user: userId,
    p_org: input.organizationId,
    p_role: input.role,
    p_invited_by: input.inviterId,
    p_issued_at: issuedAt,
    p_invited_at: issuedAt,
  });

  if (membershipError || !membership) {
    await admin.auth.admin.deleteUser(userId);
    return { ok: false, reason: "membership_failed" };
  }

  const marca = await marcaDaSaida(input.organizationId);
  const message = buildInviteEmail({
    orgName: input.orgName,
    email,
    password,
    loginUrl,
    marca,
    idioma: input.idioma,
  });
  const sent = await sendEmail({
    to: email,
    ...message,
    fromName: marca.nome,
    idempotencyKey: `team-invite/${inviteId}`,
    tags: [
      { name: "kind", value: "team_invite" },
      { name: "org", value: input.organizationId },
    ],
  });

  if (!sent.ok) {
    await admin
      .from("user_organizations")
      .delete()
      .eq("organization_id", input.organizationId)
      .eq("user_id", userId);
    await admin.auth.admin.deleteUser(userId);
    return { ok: false, reason: "email_failed" };
  }

  const membershipId = (membership as { id?: string }).id ?? userId;
  await audit({
    action: "member.invited",
    actorUserId: input.inviterId,
    organizationId: input.organizationId,
    resourceType: "membership",
    resourceId: membershipId,
    requestId: input.requestId,
    metadata: { email, role: input.role, email_dispatched: true, access_created: true },
  });

  return { ok: true, email, inviteId, loginUrl };
}
