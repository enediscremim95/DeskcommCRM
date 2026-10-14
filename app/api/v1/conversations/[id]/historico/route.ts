import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { aprofundarHistorico } from "@/lib/channels/historico";
import { requireSupportWrite } from "@/lib/impersonate/support";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function POST(_req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "conversations" });
  if (!authz.ok) return authz.response;
  const { id } = await ctx.params;

  try {
    const resultado = await aprofundarHistorico({
      organizationId: authz.org.orgId,
      conversationId: id,
    });
    if ("inseridas" in resultado && resultado.inseridas > 0) {
      void audit({
        action: "conversation.history_imported",
        actorUserId: authz.user.id,
        organizationId: authz.org.orgId,
        resourceType: "conversation",
        resourceId: id,
        requestId,
        metadata: { mensagens_inseridas: resultado.inseridas, origem: "abertura_da_conversa" },
      });
    }
    return ok(resultado, { requestId });
  } catch {
    return fail("internal_error", "Failed to load previous messages.", 500, { requestId });
  }
}
