import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";

interface EstadoDoCanal {
  automatic_attendance_enabled?: boolean;
  id?: string;
}

interface AtorDaMudanca {
  actorUserId?: string | null;
  actorApiTokenId?: string | null;
  metadata?: Record<string, unknown>;
  requestId?: string | null;
}

export type ResultadoAtendimentoAutomatico =
  | { ok: true; enabled: boolean; changed: boolean }
  | { ok: false; reason: "not_found" | "database_error" };

/**
 * A ausência ou falha de leitura é desligado, de propósito.
 * Autorizar fala exige uma confirmação positiva do banco.
 */
export async function lerAtendimentoAutomatico(
  db: SupabaseClient,
  organizationId: string,
  channelSessionId: string,
): Promise<boolean> {
  try {
    const { data, error } = await db
      .from("channel_sessions")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("id", channelSessionId)
      .is("archived_at", null)
      .maybeSingle();

    if (error || !data) return false;
    return (data as EstadoDoCanal).automatic_attendance_enabled === true;
  } catch {
    return false;
  }
}

/** Escrita tenant-aware, idempotente e auditada da chave mestra do canal. */
export async function definirAtendimentoAutomatico(
  db: SupabaseClient,
  params: {
    organizationId: string;
    channelSessionId: string;
    enabled: boolean;
    actor: AtorDaMudanca;
  },
): Promise<ResultadoAtendimentoAutomatico> {
  const { data: atual, error: readError } = await db
    .from("channel_sessions")
    .select("*")
    .eq("organization_id", params.organizationId)
    .eq("id", params.channelSessionId)
    .is("archived_at", null)
    .maybeSingle();

  if (readError) return { ok: false, reason: "database_error" };
  if (!atual) return { ok: false, reason: "not_found" };

  const anterior = (atual as EstadoDoCanal).automatic_attendance_enabled === true;
  if (anterior === params.enabled) {
    return { ok: true, enabled: params.enabled, changed: false };
  }

  const { data: alterado, error: updateError } = await db
    .from("channel_sessions")
    .update({ automatic_attendance_enabled: params.enabled } as never)
    .eq("organization_id", params.organizationId)
    .eq("id", params.channelSessionId)
    .is("archived_at", null)
    .select("id")
    .maybeSingle();

  if (updateError) return { ok: false, reason: "database_error" };
  if (!alterado) return { ok: false, reason: "not_found" };

  await audit({
    action: "channel.automatic_attendance_updated",
    actorUserId: params.actor.actorUserId,
    actorApiTokenId: params.actor.actorApiTokenId,
    organizationId: params.organizationId,
    resourceType: "channel_session",
    resourceId: params.channelSessionId,
    requestId: params.actor.requestId,
    metadata: {
      previous_enabled: anterior,
      enabled: params.enabled,
      ...params.actor.metadata,
    },
  });

  return { ok: true, enabled: params.enabled, changed: true };
}
