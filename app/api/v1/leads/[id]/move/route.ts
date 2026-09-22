import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { moveLeadHandler } from "@/app/api/v1/leads/_handler";
import { ApiError } from "@/lib/api/types";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { moveLeadSchema, validateRequest } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Porta HTTP canônica para mover um lead dentro do próprio funil.
 *
 * A posição é opcional: sem ela, o handler compartilhado coloca o lead no fim
 * da etapa. O mesmo handler também preserva atividade, evento, auditoria,
 * correção humana de movimento da IA e concorrência otimista.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const { id: leadId } = await ctx.params;
  const supabase = await createClient();
  const authz = await requireRole("agent", { requestId, resource: "crm_leads" });
  if (!authz.ok) return authz.response;

  try {
    const input = await validateRequest(moveLeadSchema, req);
    const lead = await moveLeadHandler(
      supabase,
      {
        organization_id: authz.org.orgId,
        actor: { type: "user", id: authz.user.id },
        requestId,
        idioma: authz.user.idioma,
      },
      leadId,
      {
        to_stage_id: input.stage_id,
        position_in_stage: input.position_in_stage,
        expected_updated_at: input.expected_updated_at,
      },
    );
    return ok(lead, { requestId });
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, {
        details: err.details,
        requestId,
      });
    }
    throw err;
  }
}
