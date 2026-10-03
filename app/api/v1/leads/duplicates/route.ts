import { randomUUID } from "node:crypto";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import type { GrupoDeNegociosDuplicados } from "@/lib/leads/negocios-duplicados";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "crm_lead" });
  if (!authz.ok) return authz.response;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "fn_candidatos_negocios_duplicados" as never,
    { p_organization_id: authz.org.orgId } as never,
  );
  if (error) return fail("internal_error", error.message, 500, { requestId });

  return ok((data ?? []) as unknown as GrupoDeNegociosDuplicados[], { requestId });
}
