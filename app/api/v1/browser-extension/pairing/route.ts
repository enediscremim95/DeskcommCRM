import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import {
  EXTENSION_PAIRING_CODE_TTL_MS,
  EXTENSION_TOKEN_TTL_MS,
  WHATSAPP_EXTENSION_ID,
} from "@/lib/browser-extension/constants";
import { hashExtensionSecret, novoCodigoDePareamento } from "@/lib/browser-extension/security";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

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
  const code = novoCodigoDePareamento();
  const now = Date.now();
  const { data, error } = await createAdminClient()
    .from("browser_extension_pairings")
    .insert({
      organization_id: authz.org.orgId,
      user_id: authz.user.id,
      crm_origin: req.nextUrl.origin,
      extension_id: WHATSAPP_EXTENSION_ID,
      pairing_code_hash: hashExtensionSecret(code),
      pairing_code_expires_at: new Date(now + EXTENSION_PAIRING_CODE_TTL_MS).toISOString(),
      expires_at: new Date(now + EXTENSION_TOKEN_TTL_MS).toISOString(),
      last_seen_at: new Date(now).toISOString(),
    })
    .select("id")
    .single();
  if (error || !data)
    return fail("internal_error", "Erro ao preparar a extensão.", 500, { requestId });
  return ok(
    {
      pairing_id: data.id,
      pairing_code: code,
      extension_id: WHATSAPP_EXTENSION_ID,
      crm_origin: req.nextUrl.origin,
      heartbeat_ms: 5_000,
    },
    { requestId, status: 201 },
  );
}
