import { randomUUID } from "node:crypto";

import { ApiError } from "@/lib/api/types";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { traduzir } from "@/lib/i18n/dicionario";
import { aplicarModeloAtendimento } from "@/lib/operacao/regras-automaticas";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Aplica os quatro modelos pausados. IDs determinísticos tornam o POST idempotente. */
export async function POST(): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "automation_rules" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  try {
    const resultado = await aplicarModeloAtendimento({
      supabase: await createClient(),
      organizationId: authz.org.orgId,
      actor: { type: "user", id: authz.user.id, role: authz.org.role },
      requestId,
    });
    return ok(resultado, { requestId });
  } catch (error) {
    if (error instanceof ApiError) {
      return fail(error.code, t(error.message), error.status, { requestId, details: error.details });
    }
    throw error;
  }
}
