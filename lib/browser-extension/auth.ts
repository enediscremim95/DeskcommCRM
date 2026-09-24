import type { SupabaseClient } from "@supabase/supabase-js";

import { fail } from "@/lib/api/wrappers";
import { ROLE_RANK, type Role } from "@/lib/auth/types";
import {
  EXTENSION_PRESENCE_MAX_AGE_MS,
  WHATSAPP_EXTENSION_ID,
} from "@/lib/browser-extension/constants";
import { origemDaExtensaoPermitida } from "@/lib/browser-extension/cors";
import { hashExtensionSecret } from "@/lib/browser-extension/security";
import { createAdminClient } from "@/lib/supabase/admin";

interface PairingRow {
  id: string;
  organization_id: string;
  user_id: string;
  crm_origin: string;
  extension_id: string;
  last_seen_at: string | null;
  expires_at: string;
  revoked_at: string | null;
}

export interface ExtensionAuth {
  pairingId: string;
  organizationId: string;
  userId: string;
  role: Role;
  crmOrigin: string;
  admin: SupabaseClient;
}

function bearer(req: Request): string | null {
  const value = req.headers.get("authorization") ?? "";
  return value.startsWith("Bearer ext_") ? value.slice(7) : null;
}

export async function autenticarExtensao(
  req: Request,
  minRole: Role = "agent",
): Promise<{ ok: true; auth: ExtensionAuth } | { ok: false; response: Response }> {
  const token = bearer(req);
  if (
    !token ||
    !origemDaExtensaoPermitida(req) ||
    req.headers.get("x-extension-id") !== WHATSAPP_EXTENSION_ID
  ) {
    return { ok: false, response: fail("unauthenticated", "Entre no CRM para usar.", 401) };
  }
  const admin: SupabaseClient = createAdminClient();
  const { data } = await admin
    .from("browser_extension_pairings")
    .select(
      "id, organization_id, user_id, crm_origin, extension_id, last_seen_at, expires_at, revoked_at",
    )
    .eq("access_token_hash", hashExtensionSecret(token))
    .eq("extension_id", WHATSAPP_EXTENSION_ID)
    .is("revoked_at", null)
    .maybeSingle();
  const row = data as PairingRow | null;
  const presence = row?.last_seen_at ? Date.parse(row.last_seen_at) : 0;
  if (
    !row ||
    new URL(req.url).origin !== row.crm_origin ||
    Date.parse(row.expires_at) <= Date.now() ||
    Date.now() - presence > EXTENSION_PRESENCE_MAX_AGE_MS
  ) {
    return {
      ok: false,
      response: fail("extension_session_required", "Entre no CRM para usar.", 401),
    };
  }
  const { data: membership } = await admin
    .from("user_organizations")
    .select("role")
    .eq("organization_id", row.organization_id)
    .eq("user_id", row.user_id)
    .is("revoked_at", null)
    .maybeSingle();
  const role = (membership?.role ?? null) as Role | null;
  if (!role || (ROLE_RANK[role] ?? 0) < ROLE_RANK[minRole]) {
    return { ok: false, response: fail("forbidden_role", "Permissão insuficiente.", 403) };
  }
  return {
    ok: true,
    auth: {
      pairingId: row.id,
      organizationId: row.organization_id,
      userId: row.user_id,
      role,
      crmOrigin: row.crm_origin,
      admin,
    },
  };
}
