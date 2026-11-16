import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { capturePolicy, capturePolicySchema } from "@/lib/proactivity/capture-policy";
export const dynamic = "force-dynamic";
export async function GET() {
 const requestId = randomUUID();
 const auth = await requireRole("admin", { requestId, resource: "proactivity" });
 if (!auth.ok) return auth.response;
 const { data, error } = await createAdminClient().from("organizations").select("settings").eq("id", auth.org.orgId).maybeSingle();
 if (error || !data) return fail("internal_error", "Não foi possível ler a configuração.", 500, { requestId });
 return ok(capturePolicy(data.settings), { requestId });
}
export async function PATCH(req: NextRequest) {
 const denied = await requireSupportWrite(); if (denied) return denied;
 const requestId = randomUUID();
 const auth = await requireRole("admin", { requestId, resource: "proactivity" });
 if (!auth.ok) return auth.response;
 const parsed = capturePolicySchema.safeParse(await req.json().catch(() => null));
 if (!parsed.success) return fail("validation_failed", "Configuração inválida.", 422, { requestId });
 const db = createAdminClient();
 if (parsed.data.channel_session_id) {
  const channel = await db.from("channel_sessions").select("id").eq("organization_id", auth.org.orgId).eq("id", parsed.data.channel_session_id).is("archived_at", null).maybeSingle();
  if (channel.error || !channel.data) return fail("validation_failed", "Escolha um canal ativo desta organização.", 422, { requestId });
 }
 const { data, error } = await db.from("organizations").select("settings").eq("id", auth.org.orgId).maybeSingle();
 if (error || !data) return fail("internal_error", "Não foi possível ler a configuração.", 500, { requestId });
 const { data: saved, error: saveError } = await db.from("organizations")
  .update({ settings: { ...(data.settings ?? {}), capture_proactivity: parsed.data } })
  .eq("id", auth.org.orgId).eq("settings", data.settings).select("id").maybeSingle();
 if (saveError) return fail("internal_error", "Não foi possível salvar a configuração.", 500, { requestId });
 if (!saved) return fail("conflict", "A configuração mudou. Recarregue e tente novamente.", 409, { requestId });
 void audit({ action: "capture.proactivity_config_changed", organizationId: auth.org.orgId, actorUserId: auth.user.id, resourceType: "organization", resourceId: auth.org.orgId, requestId, metadata: { enabled: parsed.data.enabled, max_attempts: parsed.data.max_whatsapp_attempts } });
 return ok(parsed.data, { requestId });
}
