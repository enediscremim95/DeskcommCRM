import { AuthTemporariamenteIndisponivel } from "@/lib/auth/get-user-com-backoff";
import { comAuthDisponivel } from "@/lib/auth/api-disponivel";
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok } from "@/lib/api/wrappers";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { syncTrafficDashboards } from "@/lib/windsor/sync";

export const dynamic = "force-dynamic";
async function POSTComAuth(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  let adminContext: Awaited<ReturnType<typeof requirePlatformAdmin>>;
  try { adminContext = await requirePlatformAdmin(); } catch (erroDeAuth) {
    if (erroDeAuth instanceof AuthTemporariamenteIndisponivel) throw erroDeAuth;
    return fail("forbidden", "Platform admin required", 403, { requestId });
  }
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return fail("validation_error", "Organização inválida.", 400, { requestId });
  }
  try {
    const result = await syncTrafficDashboards({
      trigger: "manual", organizationId: id, actorUserId: adminContext.user.id,
    });
    return result.failed > 0
      ? fail("upstream_unavailable", "A sincronização falhou; o último dado bom foi preservado.", 502, { requestId, details: result })
      : ok(result, { requestId });
  } catch (erroDeAuth) {
    if (erroDeAuth instanceof AuthTemporariamenteIndisponivel) throw erroDeAuth;
    return fail("upstream_unavailable", "A sincronização não pôde ser iniciada.", 502, { requestId });
  }
}

export const POST = comAuthDisponivel(POSTComAuth);
