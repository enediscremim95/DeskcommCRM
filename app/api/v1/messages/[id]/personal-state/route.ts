import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { traduzir } from "@/lib/i18n/dicionario";
import {
  lerEstadoPessoalDaMensagem,
  salvarEstadoPessoalDaMensagem,
} from "@/lib/inbox/preferencias-pessoais";
import { updateInboxMessageStateSchema } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "inbox_personal_state" });
  if (!authz.ok) return authz.response;
  const { id } = await ctx.params;
  try {
    return ok(
      await lerEstadoPessoalDaMensagem(await createClient(), authz.org.orgId, authz.user.id, id),
      { requestId },
    );
  } catch {
    return fail("internal_error", traduzir("Falha ao carregar preferências.", authz.user.idioma), 500, { requestId });
  }
}

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "inbox_personal_state" });
  if (!authz.ok) return authz.response;
  const t = (text: string) => traduzir(text, authz.user.idioma);
  const { id } = await ctx.params;
  let raw: unknown;
  try { raw = await req.json(); } catch {
    return fail("invalid_request", t("Body JSON inválido."), 400, { requestId });
  }
  const parsed = updateInboxMessageStateSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("validation_failed", t("Campos inválidos."), 422, { requestId, details: parsed.error.flatten() });
  }
  try {
    const state = await salvarEstadoPessoalDaMensagem(
      await createClient(), authz.org.orgId, authz.user.id, id, parsed.data.starred,
    );
    await audit({
      action: "inbox.message_preference_changed",
      actorUserId: authz.user.id,
      organizationId: authz.org.orgId,
      resourceType: "message",
      resourceId: id,
      requestId,
      metadata: { changed: ["starred"] },
    });
    return ok(state, { requestId });
  } catch (error) {
    if (error instanceof Error && error.message === "message_not_found") {
      return fail("not_found", t("Mensagem não encontrada."), 404, { requestId });
    }
    return fail("internal_error", t("Falha ao salvar preferências."), 500, { requestId });
  }
}
