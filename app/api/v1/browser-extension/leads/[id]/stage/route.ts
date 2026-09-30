import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { moveLeadHandler } from "@/app/api/v1/leads/_handler";
import { ApiError } from "@/lib/api/types";
import { fail, ok } from "@/lib/api/wrappers";
import { autenticarExtensao } from "@/lib/browser-extension/auth";
import { comCorsDaExtensao, respostaPreflightDaExtensao } from "@/lib/browser-extension/cors";
import { requireSupportWrite } from "@/lib/impersonate/support";

const schema = z.object({ stage_id: z.string().uuid() });
export const dynamic = "force-dynamic";
export const OPTIONS = respostaPreflightDaExtensao;

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return comCorsDaExtensao(supportDenied);
  const authn = await autenticarExtensao(req, "agent");
  if (!authn.ok) return comCorsDaExtensao(authn.response);
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return comCorsDaExtensao(fail("validation_failed", "Etapa inválida.", 422, { requestId }));
  const { id } = await ctx.params;
  const { admin, organizationId, userId } = authn.auth;
  try {
    const lead = await moveLeadHandler(
      admin,
      {
        organization_id: organizationId,
        actor: { type: "user", id: userId },
        requestId,
      },
      id,
      { to_stage_id: parsed.data.stage_id, reason: "Alterado no apoio do WhatsApp Web" },
    );
    return comCorsDaExtensao(ok(lead, { requestId }));
  } catch (error) {
    if (error instanceof ApiError)
      return comCorsDaExtensao(
        fail(error.code, error.message, error.status, { requestId, details: error.details }),
      );
    throw error;
  }
}
