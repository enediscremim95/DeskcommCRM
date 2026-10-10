import { randomUUID } from "node:crypto";

import { audit } from "@/lib/audit";
import { marcaDaSaida } from "@/lib/branding/saida";
import { env } from "@/lib/env";
import { sendEmail } from "@/lib/email/resend";
import { buildInviteEmail } from "@/lib/email/templates/invite";
import type { Idioma } from "@/lib/i18n/idiomas";
import { createAdminClient } from "@/lib/supabase/admin";

import { generateProvisionalPassword } from "./provisional-password";

export type VerificarReenvioAcessoResult =
  | {
      ok: true;
      email: string;
      userId: string;
      membershipId: string;
    }
  | {
      ok: false;
      reason: "nao_membro" | "ja_acessou" | "lookup_failed";
    };

export type ReenviarAcessoDeEquipeResult =
  | { ok: true; email: string; inviteId: string; loginUrl: string }
  | {
      ok: false;
      reason:
        | "nao_membro"
        | "ja_acessou"
        | "lookup_failed"
        | "update_failed"
        | "email_failed";
    };

/**
 * Confere a elegibilidade sem consultar o schema `auth` pelo PostgREST.
 * A Admin API do GoTrue é a fonte de e-mail e histórico de login.
 */
export async function verificarReenvioAcessoDeEquipe(input: {
  organizationId: string;
  email: string;
}): Promise<VerificarReenvioAcessoResult> {
  const admin = createAdminClient();
  const email = input.email.trim().toLowerCase();
  const { data: memberships, error } = await admin
    .from("user_organizations")
    .select("id, user_id")
    .eq("organization_id", input.organizationId)
    .is("revoked_at", null);

  if (error) return { ok: false, reason: "lookup_failed" };

  let authLookupFailed = false;
  for (const membership of memberships ?? []) {
    const { data, error: userError } = await admin.auth.admin.getUserById(
      membership.user_id as string,
    );
    if (userError || !data.user) {
      authLookupFailed = true;
      continue;
    }
    if (data.user.email?.trim().toLowerCase() !== email) continue;
    if (data.user.last_sign_in_at) return { ok: false, reason: "ja_acessou" };
    return {
      ok: true,
      email,
      userId: data.user.id,
      membershipId: membership.id as string,
    };
  }

  return { ok: false, reason: authLookupFailed ? "lookup_failed" : "nao_membro" };
}

export async function reenviarAcessoDeEquipe(input: {
  organizationId: string;
  orgName: string;
  email: string;
  actorUserId: string | null;
  requestId: string;
  idioma: Idioma;
}): Promise<ReenviarAcessoDeEquipeResult> {
  const elegibilidade = await verificarReenvioAcessoDeEquipe(input);
  if (!elegibilidade.ok) return elegibilidade;

  const admin = createAdminClient();
  const password = generateProvisionalPassword();
  const inviteId = randomUUID();
  const loginUrl = `${env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/login`;
  const { error: updateError } = await admin.auth.admin.updateUserById(
    elegibilidade.userId,
    { password, email_confirm: true },
  );
  if (updateError) return { ok: false, reason: "update_failed" };

  try {
    const marca = await marcaDaSaida(input.organizationId);
    const message = buildInviteEmail({
      orgName: input.orgName,
      email: elegibilidade.email,
      password,
      loginUrl,
      marca,
      idioma: input.idioma,
    });
    const sent = await sendEmail({
      to: elegibilidade.email,
      ...message,
      fromName: marca.nome,
      idempotencyKey: `team-reaccess/${inviteId}`,
      tags: [
        { name: "kind", value: "team_reaccess" },
        { name: "org", value: input.organizationId },
      ],
    });
    if (!sent.ok) return { ok: false, reason: "email_failed" };
  } catch {
    return { ok: false, reason: "email_failed" };
  }

  await audit({
    action: "member.invited",
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    resourceType: "membership",
    resourceId: elegibilidade.membershipId,
    requestId: input.requestId,
    metadata: { reissued: true },
  });

  return { ok: true, email: elegibilidade.email, inviteId, loginUrl };
}
