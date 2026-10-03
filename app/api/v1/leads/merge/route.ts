import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ApiError } from "@/lib/api/types";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import {
  erroPrevistoDaJuncao,
  type ResultadoJuncaoDeNegocios,
} from "@/lib/leads/negocios-duplicados";
import { mergeDuplicateLeadSchema, validateRequest } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "crm_lead" });
  if (!authz.ok) return authz.response;

  let input;
  try {
    input = await validateRequest(mergeDuplicateLeadSchema, req);
  } catch (error) {
    if (error instanceof ApiError) {
      return fail(error.code, error.message, error.status, {
        details: error.details,
        requestId,
      });
    }
    throw error;
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "fn_juntar_negocios" as never,
    {
      p_organization_id: authz.org.orgId,
      p_survivor: input.survivor_lead_id,
      p_absorbed: input.absorbed_lead_id,
    } as never,
  );
  if (error) {
    const previsto = erroPrevistoDaJuncao(error.message);
    return fail(
      previsto?.code ?? "internal_error",
      previsto?.message ?? error.message,
      previsto?.status ?? 500,
      { requestId },
    );
  }

  const resultado = data as unknown as ResultadoJuncaoDeNegocios;
  if (resultado.outcome === "merged") {
    await audit({
      action: "lead.duplicate_merged",
      actorUserId: authz.user.id,
      organizationId: authz.org.orgId,
      resourceType: "crm_lead_merge",
      resourceId: resultado.log_id,
      requestId,
      metadata: {
        survivor_lead_id: resultado.survivor_lead_id,
        absorbed_lead_id: resultado.absorbed_lead_id,
        outcome: resultado.outcome,
      },
    });
  }
  return ok(resultado, { requestId });
}
