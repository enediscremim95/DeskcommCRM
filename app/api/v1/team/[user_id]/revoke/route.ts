import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * POST /api/v1/team/[user_id]/revoke — revoke a member.
 *
 * Guardrails:
 *  - Caller must have `team.manage`.
 *  - Cannot revoke self.
 *  - Actor and affected role are recorded in the audit log.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/require-permission";
import { createClient } from "@/lib/supabase/server";
import { traduzir } from "@/lib/i18n/dicionario";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ user_id: string }> },
): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const { user_id: targetUserId } = await ctx.params;

  const authz = await requirePermission("team.manage", { requestId, resource: "team" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { user: authUser, org: activeOrg } = authz;
  if (targetUserId === authUser.id) {
    return fail("state_conflict", t("Não é possível revogar o próprio acesso."), 409, { requestId });
  }

  const supabase = await createClient();

  const { data: target, error: fetchErr } = await supabase
    .from("user_organizations")
    .select("id, user_id, role, revoked_at")
    .eq("organization_id", activeOrg.orgId)
    .eq("user_id", targetUserId)
    .maybeSingle();
  if (fetchErr) return fail("internal_error", fetchErr.message, 500, { requestId });
  if (!target) return fail("not_found", t("Membro não encontrado."), 404, { requestId });
  if (target.revoked_at) {
    return ok({ user_id: targetUserId, already_revoked: true }, { requestId });
  }

  const nowIso = new Date().toISOString();
  const { error: updErr } = await supabase
    .from("user_organizations")
    .update({ revoked_at: nowIso, updated_at: nowIso })
    .eq("id", target.id);
  if (updErr) return fail("internal_error", updErr.message, 500, { requestId });

  await audit({
    action: "member.revoked",
    actorUserId: authUser.id,
    organizationId: activeOrg.orgId,
    resourceType: "membership",
    resourceId: target.id,
    requestId,
    metadata: { target_user_id: targetUserId, revoked_role: target.role },
  });

  return ok({ user_id: targetUserId, revoked_at: nowIso }, { requestId });
}
