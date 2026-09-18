import { randomUUID } from "node:crypto";
import { fail, ok } from "@/lib/api/wrappers";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { findManagedConnector } from "@/lib/channels/managed-qr";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export async function GET() {
  const requestId = randomUUID();
  const user = await loadAuthUser();
  if (!user) return fail("unauthenticated", "Sessão expirada.", 401, { requestId });
  const org = await resolveActiveOrg(user);
  if (!org) return fail("forbidden_tenant", "Nenhuma organização ativa.", 403, { requestId });
  try { return ok(await findManagedConnector(createAdminClient(), org.orgId), { requestId }); }
  catch { return fail("internal_error", "Não foi possível carregar o conector.", 500, { requestId }); }
}
