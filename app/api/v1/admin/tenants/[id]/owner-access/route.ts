import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { mfaEmDivida } from "@/lib/auth/server";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { provisionOwnerAccess } from "@/lib/auth/provision-owner-access";
import { ok, fail } from "@/lib/api/wrappers";

export async function POST(_req: Request, context: { params: Promise<{ id: string }> }) {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  let ctx: Awaited<ReturnType<typeof requirePlatformAdmin>>;
  try { ctx = await requirePlatformAdmin(); } catch {
    return fail("forbidden", "Acesso de administrador necessário.", 403, { requestId });
  }
  if (ctx.platformAdmin.scope !== "full") return fail("forbidden", "Acesso de administrador necessário.", 403, { requestId });
  if (await mfaEmDivida()) return fail("mfa_required", "Confirme a verificação em duas etapas.", 403, { requestId });
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return fail("validation_error", "Organização inválida.", 400, { requestId });
  return ok({ owner_access: await provisionOwnerAccess({ organizationId: id, actorId: ctx.user.id, requestId }) }, { requestId });
}

/** Estado recuperável depois de recarregar a tela, sem projetar segredo ou e-mail. */
export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();
  try {
    const ctx = await requirePlatformAdmin();
    if (ctx.platformAdmin.scope !== "full") return fail("forbidden", "Acesso de administrador necessário.", 403, { requestId });
    if (await mfaEmDivida()) return fail("mfa_required", "Confirme a verificação em duas etapas.", 403, { requestId });
    const { id } = await context.params;
    if (!z.string().uuid().safeParse(id).success) return fail("validation_error", "Organização inválida.", 400, { requestId });
    const { data, error } = await createAdminClient().from("tenant_owner_access")
      .select("status").eq("organization_id", id).maybeSingle();
    if (error) return fail("internal_error", "Não foi possível consultar o acesso.", 500, { requestId });
    return ok({ owner_access: data ? {
      status: data.status === "pending" ? "failed" : data.status,
      login_url: `${env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/login`,
      retryable: data.status === "pending",
    } : null }, { requestId });
  } catch {
    return fail("forbidden", "Acesso de administrador necessário.", 403, { requestId });
  }
}
