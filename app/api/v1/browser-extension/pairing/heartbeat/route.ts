import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSupportWrite } from "@/lib/impersonate/support";

const inputSchema = z.object({ pairing_id: z.string().uuid() });
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  if (req.headers.get("origin") !== req.nextUrl.origin) {
    return fail("forbidden", "Origem inválida.", 403, { requestId });
  }
  const authz = await requireRole("agent", { requestId, resource: "browser_extension" });
  if (!authz.ok) return authz.response;
  const parsed = inputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", "Pareamento inválido.", 422, { requestId });
  const { data, error } = await createAdminClient()
    .from("browser_extension_pairings")
    .update({
      organization_id: authz.org.orgId,
      last_seen_at: new Date().toISOString(),
    })
    .eq("id", parsed.data.pairing_id)
    .eq("user_id", authz.user.id)
    .eq("crm_origin", req.nextUrl.origin)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("id")
    .maybeSingle();
  if (error || !data) return fail("not_found", "Pareamento expirado.", 404, { requestId });
  return ok({ active: true, organization_id: authz.org.orgId }, { requestId });
}
