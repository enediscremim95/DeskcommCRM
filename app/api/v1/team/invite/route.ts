import { requireSupportWrite } from "@/lib/impersonate/support";
import { issueInvite } from "@/lib/auth/issue-invite";
import { provisionTeamAccess } from "@/lib/auth/provision-team-access";
import { isServiceRoleConfigured } from "@/lib/audit";
import { isEmailConfigured } from "@/lib/email/resend";
/**
 * POST /api/v1/team/invite — bulk-invite up to 20 emails.
 *
 * Contas novas recebem senha provisória e vínculo ativo. Contas existentes
 * preservam senha/MFA e usam o convite legado assinado. A rota de aceite
 * continua válida para convites que já estavam em andamento.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { ApiError } from "@/lib/api/types";

import { requirePermission } from "@/lib/auth/require-permission";
import { createAdminClient } from "@/lib/supabase/admin";
import { inviteMemberSchema, validateRequest } from "@/lib/schemas";

export const dynamic = "force-dynamic";

interface SentItem {
  email: string;
  invite_id: string;
  expires_at: string | null;
  email_dispatched: boolean;
  accept_url: string;
}
interface FailedItem {
  email: string;
  reason: string;
}

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requirePermission("team.manage", { requestId, resource: "team" });
  if (!authz.ok) return authz.response;
  const { user: authUser, org: activeOrg } = authz;

  let input;
  try {
    input = await validateRequest(inviteMemberSchema, req);
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, {
        details: err.details as Record<string, unknown> | undefined,
        requestId,
      });
    }
    throw err;
  }

  const sent: SentItem[] = [];
  const failed: FailedItem[] = [];

  if (!isEmailConfigured()) {
    return fail("unavailable", "Configure o envio de e-mail antes de convidar uma pessoa.", 503, {
      requestId,
    });
  }

  const admin = isServiceRoleConfigured() ? createAdminClient() : null;
  const inviterName = authUser.full_name ?? authUser.email ?? "Um colega";
  // Emails com membership ATIVA na org — para pular o reconvite de quem já é membro.
  // O schema `auth` NÃO é acessível via PostgREST (erro "Invalid schema: auth"), então
  // resolvemos email↔usuário pela GoTrue admin API (getUserById) — mesmo padrão de
  // app/api/v1/team/route.ts. N pequeno (poucos membros por org no perfil BPO).
  const memberEmails = new Set<string>();
  if (admin) {
    const { data: members } = await admin
      .from("user_organizations")
      .select("user_id")
      .eq("organization_id", activeOrg.orgId)
      .is("revoked_at", null);
    for (const m of members ?? []) {
      const { data: u } = await admin.auth.admin.getUserById(m.user_id as string);
      const memberEmail = u?.user?.email?.trim().toLowerCase();
      if (memberEmail) memberEmails.add(memberEmail);
    }
  }

  for (const inv of input.invitations) {
    const email = inv.email.trim().toLowerCase();

    // já é membro ativo → pula (não reenvia convite)
    if (memberEmails.has(email)) {
      failed.push({ email, reason: "already_member" });
      continue;
    }

    const access = await provisionTeamAccess({
      email,
      role: inv.role,
      interfaceSettings: inv.interface_settings ?? { preset: "completa" },
      organizationId: activeOrg.orgId,
      orgName: activeOrg.name,
      inviterId: authUser.id,
      requestId,
      idioma: authUser.idioma,
    });

    if (access.ok) {
      sent.push({
        email,
        invite_id: access.inviteId,
        expires_at: null,
        email_dispatched: true,
        accept_url: access.loginUrl,
      });
      continue;
    }

    // Conta anterior conserva senha e MFA: recebe o convite legado, sem reset.
    if (access.reason === "existing_user") {
      sent.push(
        await issueInvite({
          email,
          role: inv.role,
          interfaceSettings: inv.interface_settings,
          organizationId: activeOrg.orgId,
          orgName: activeOrg.name,
          inviterId: authUser.id,
          inviterName,
          requestId,
        }),
      );
      continue;
    }

    failed.push({ email, reason: access.reason });
  }

  return ok({ sent, failed }, { status: 201, requestId });
}
