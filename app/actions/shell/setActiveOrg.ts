"use server";
import { cookies } from "next/headers";
import { z } from "zod";
import { loadAuthUser, mfaEmDivida } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { cookieSecure } from "@/lib/supabase/cookie-secure";
import { audit } from "@/lib/audit";

export async function setActiveOrg(orgId: string): Promise<{ ok: boolean; error?: string; pipelineId?: string }> {
  if (!z.string().uuid().safeParse(orgId).success) return { ok: false, error: "invalid_organization" };
  const user = await loadAuthUser();
  if (!user) return { ok: false, error: "auth_required" };
  if (user.support) return { ok: false, error: "Encerre o acompanhamento antes de trocar de organização." };
  if (await mfaEmDivida()) return { ok: false, error: "mfa_required" };
  // Consulta fresca: não usa status de membership serializado no browser.
  const db = await createClient();
  const { data: membership, error } = await db.from("user_organizations")
    .select("organization_id, organizations!inner(status)")
    .eq("organization_id", orgId).eq("user_id", user.id)
    .is("revoked_at", null).not("accepted_at", "is", null)
    .eq("organizations.status", "active").maybeSingle();
  if (error || !membership) return { ok: false, error: "forbidden" };
  const store = await cookies();
  const previous = store.get("active_org")?.value;
  store.set("active_org", orgId, {
    httpOnly: true, sameSite: "strict", secure: cookieSecure(), path: "/", maxAge: 60 * 60 * 24 * 30,
  });
  await audit({ action: "organization.switched", actorUserId: user.id,
    organizationId: orgId, resourceType: "organization", resourceId: orgId,
    metadata: { previous_organization_id: z.string().uuid().safeParse(previous).success ? previous : null } });
  // Funil padrão da org nova: o cliente vai direto ao quadro e pula o salto
  // /app/kanban → redirect → /app/pipelines/<id>, que repetia o layout inteiro
  // (auth + dezenas de consultas) só para descobrir este id. Falha aqui nunca
  // bloqueia a troca: sem id, o cliente cai no /app/kanban como antes.
  const pipelineId = await funilPadraoDaOrg(db, orgId);
  return { ok: true, ...(pipelineId ? { pipelineId } : {}) };
}

async function funilPadraoDaOrg(
  db: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
): Promise<string | null> {
  try {
    const { data } = await db.from("crm_pipelines").select("id")
      .eq("organization_id", orgId).eq("is_archived", false)
      .order("is_default", { ascending: false }).order("position").limit(1).maybeSingle();
    const id = (data as { id?: unknown } | null)?.id;
    return z.string().uuid().safeParse(id).success ? (id as string) : null;
  } catch {
    return null;
  }
}
