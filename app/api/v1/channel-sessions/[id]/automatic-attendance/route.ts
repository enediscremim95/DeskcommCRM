import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import {
  definirAtendimentoAutomatico,
} from "@/lib/channels/atendimento-automatico";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
const updateSchema = z.object({ enabled: z.boolean() }).strict();

export async function GET(_req: NextRequest, { params }: Context): Promise<Response> {
  const requestId = randomUUID();
  const auth = await requireRole("manager", {
    requestId,
    resource: "channel_sessions",
    allowPlatformAdmin: true,
  });
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!z.uuid().safeParse(id).success) {
    return fail("validation_failed", "Canal inválido.", 422, { requestId });
  }

  const db = createAdminClient();
  const { data, error } = await db
    .from("channel_sessions")
    .select("*")
    .eq("organization_id", auth.org.orgId)
    .eq("id", id)
    .is("archived_at", null)
    .maybeSingle();
  if (error) {
    return fail("internal_error", "Não foi possível carregar o atendimento automático.", 500, { requestId });
  }
  if (!data) return fail("not_found", "Canal não encontrado.", 404, { requestId });

  const enabled = (data as { automatic_attendance_enabled?: boolean }).automatic_attendance_enabled === true;
  return ok({ enabled }, { requestId });
}

export async function PATCH(req: NextRequest, { params }: Context): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const auth = await requireRole("manager", {
    requestId,
    resource: "channel_sessions",
    allowPlatformAdmin: true,
  });
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!z.uuid().safeParse(id).success) {
    return fail("validation_failed", "Canal inválido.", 422, { requestId });
  }
  const parsed = updateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", "Informe se o atendimento deve ficar ligado ou desligado.", 422, { requestId });
  }

  const result = await definirAtendimentoAutomatico(createAdminClient(), {
    organizationId: auth.org.orgId,
    channelSessionId: id,
    enabled: parsed.data.enabled,
    actor: { actorUserId: auth.user.id, requestId },
  });
  if (!result.ok && result.reason === "not_found") {
    return fail("not_found", "Canal não encontrado.", 404, { requestId });
  }
  if (!result.ok) {
    return fail("internal_error", "Não foi possível alterar o atendimento automático.", 500, { requestId });
  }
  return ok({ enabled: result.enabled }, { requestId });
}
