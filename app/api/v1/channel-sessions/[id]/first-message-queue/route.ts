import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { traduzir } from "@/lib/i18n/dicionario";
import { dayStartInTz } from "@/lib/agent-engine/pacing/engine";
import { FILA_PRIMEIRA_MENSAGEM_DEFAULTS } from "@/lib/automation/fila-primeira-mensagem";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

const updateSchema = z
  .object({
    paused: z.boolean().optional(),
    min_interval_seconds: z.number().int().min(1).max(86_400).optional(),
    max_interval_seconds: z.number().int().min(1).max(86_400).optional(),
    daily_limit: z.number().int().min(1).max(10_000).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);

interface KnobsFila {
  timezone?: string | null;
  first_message_queue_min_interval_seconds?: number | null;
  first_message_queue_max_interval_seconds?: number | null;
  first_message_queue_daily_limit?: number | null;
  first_message_queue_paused?: boolean | null;
  first_message_queue_next_at?: string | null;
}

async function canalExiste(organizationId: string, channelSessionId: string): Promise<boolean> {
  const { data } = await createAdminClient()
    .from("channel_sessions")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("id", channelSessionId)
    .is("archived_at", null)
    .maybeSingle();
  return Boolean(data);
}

async function estadoDaFila(organizationId: string, channelSessionId: string) {
  const db = createAdminClient();
  const { data: rawKnobs, error: knobsError } = await db
    .from("channel_knobs")
    .select(
      "timezone, first_message_queue_min_interval_seconds, first_message_queue_max_interval_seconds, first_message_queue_daily_limit, first_message_queue_paused, first_message_queue_next_at",
    )
    .eq("organization_id", organizationId)
    .eq("channel_session_id", channelSessionId)
    .maybeSingle();
  if (knobsError) throw knobsError;

  const knobs = (rawKnobs ?? {}) as KnobsFila;
  const timezone = knobs.timezone || "America/Sao_Paulo";
  const today = dayStartInTz(new Date(), timezone).toISOString();
  const [{ count: queued, error: queuedError }, { count: sentToday, error: sentError }] =
    await Promise.all([
      db
        .from("automation_first_message_queue")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("channel_session_id", channelSessionId)
        .in("status", ["queued", "processing"]),
      db
        .from("automation_first_message_queue")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("channel_session_id", channelSessionId)
        .eq("status", "sent")
        .gte("finished_at", today),
    ]);
  if (queuedError) throw queuedError;
  if (sentError) throw sentError;

  return {
    queued: queued ?? 0,
    next_send_at: knobs.first_message_queue_next_at ?? null,
    sent_today: sentToday ?? 0,
    paused: knobs.first_message_queue_paused ?? FILA_PRIMEIRA_MENSAGEM_DEFAULTS.paused,
    min_interval_seconds:
      knobs.first_message_queue_min_interval_seconds ??
      FILA_PRIMEIRA_MENSAGEM_DEFAULTS.minIntervalSeconds,
    max_interval_seconds:
      knobs.first_message_queue_max_interval_seconds ??
      FILA_PRIMEIRA_MENSAGEM_DEFAULTS.maxIntervalSeconds,
    daily_limit:
      knobs.first_message_queue_daily_limit ?? FILA_PRIMEIRA_MENSAGEM_DEFAULTS.dailyLimit,
    timezone,
  };
}

export async function GET(_req: NextRequest, { params }: Context): Promise<Response> {
  const requestId = randomUUID();
  const auth = await requireRole("manager", {
    requestId,
    resource: "channel_sessions",
    allowPlatformAdmin: true,
  });
  if (!auth.ok) return auth.response;
  const t = (texto: string) => traduzir(texto, auth.user.idioma);
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) {
    return fail("validation_failed", t("Canal inválido."), 422, { requestId });
  }
  if (!(await canalExiste(auth.org.orgId, id))) {
    return fail("not_found", t("Canal não encontrado."), 404, { requestId });
  }
  try {
    return ok(await estadoDaFila(auth.org.orgId, id), { requestId });
  } catch {
    return fail("internal_error", t("Não foi possível carregar a fila."), 500, { requestId });
  }
}

export async function PATCH(req: NextRequest, { params }: Context): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const auth = await requireRole("manager", {
    requestId,
    resource: "channel_sessions",
    allowPlatformAdmin: true,
  });
  if (!auth.ok) return auth.response;
  const t = (texto: string) => traduzir(texto, auth.user.idioma);
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) {
    return fail("validation_failed", t("Canal inválido."), 422, { requestId });
  }
  const parsed = updateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", t("Configuração da fila inválida."), 422, { requestId });
  }
  if (!(await canalExiste(auth.org.orgId, id))) {
    return fail("not_found", t("Canal não encontrado."), 404, { requestId });
  }

  const before = await estadoDaFila(auth.org.orgId, id);
  const min = parsed.data.min_interval_seconds ?? before.min_interval_seconds;
  const max = parsed.data.max_interval_seconds ?? before.max_interval_seconds;
  if (min > max) {
    return fail(
      "validation_failed",
      t("O intervalo mínimo não pode ser maior que o máximo."),
      422,
      { requestId },
    );
  }

  const db = createAdminClient();
  const { error } = await db.from("channel_knobs").upsert(
    {
      organization_id: auth.org.orgId,
      channel_session_id: id,
      first_message_queue_paused: parsed.data.paused ?? before.paused,
      first_message_queue_min_interval_seconds: min,
      first_message_queue_max_interval_seconds: max,
      first_message_queue_daily_limit: parsed.data.daily_limit ?? before.daily_limit,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id,channel_session_id" },
  );
  if (error) {
    return fail("internal_error", t("Não foi possível alterar a fila."), 500, { requestId });
  }

  if (before.paused && parsed.data.paused === false) {
    const { data: waiting } = await db
      .from("automation_first_message_queue")
      .select("queue_event_id")
      .eq("organization_id", auth.org.orgId)
      .eq("channel_session_id", id)
      .eq("status", "queued")
      .not("queue_event_id", "is", null);
    const eventIds = (waiting ?? [])
      .map((row) => row.queue_event_id as string | null)
      .filter((value): value is string => Boolean(value));
    if (eventIds.length) {
      await db
        .from("event_log")
        .update({ next_attempt_at: new Date().toISOString() })
        .eq("organization_id", auth.org.orgId)
        .eq("status", "pending")
        .in("id", eventIds);
    }
  }

  await audit({
    action: "channel.first_message_queue_updated",
    actorUserId: auth.user.id,
    organizationId: auth.org.orgId,
    resourceType: "channel_session",
    resourceId: id,
    requestId,
    bypassedRls: true,
    metadata: { before, requested: parsed.data },
  });
  return ok(await estadoDaFila(auth.org.orgId, id), { requestId });
}
