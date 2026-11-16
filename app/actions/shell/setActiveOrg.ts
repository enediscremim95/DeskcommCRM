"use server";
import { cookies } from "next/headers";
import { z } from "zod";
import { loadAuthUser, mfaEmDivida } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { cookieSecure } from "@/lib/supabase/cookie-secure";
import { audit } from "@/lib/audit";
import { AuthIndisponivelError } from "@/lib/auth/auth-indisponivel";

export async function setActiveOrg(orgId: string): Promise<{ ok: boolean; error?: string; pipelineId?: string }> {
  if (!z.string().uuid().safeParse(orgId).success) return { ok: false, error: "invalid_organization" };
  let user;
  try {
    user = await loadAuthUser();
  } catch (error) {
    if (error instanceof AuthIndisponivelError) return { ok: false, error: "auth_unavailable" };
    throw error;
  }
  if (!user) return { ok: false, error: "auth_required" };
  if (user.support) return { ok: false, error: "Encerre o acompanhamento antes de trocar de organização." };
  if (await mfaEmDivida()) return { ok: false, error: "mfa_required" };
  // MESMA fonte que `resolveActiveOrg` usa para aceitar uma organização: os
  // vínculos não revogados lidos agora por `loadAuthUser` (ação não memoiza).
  // Antes havia uma consulta própria, MAIS RÍGIDA que a RLS e o layout
  // (exigia `accepted_at` e `organizations.status = 'active'`, e `maybeSingle`
  // falhava com mais de uma linha): dono com vínculo sem `accepted_at` ou org em
  // outro status recebia "Não foi possível trocar de organização" tendo acesso.
  if (!user.organizations.some((org) => org.organization_id === orgId)) {
    return { ok: false, error: "forbidden" };
  }
  const db = await createClient();
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
