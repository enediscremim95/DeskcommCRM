/**
 * Drena a reserva Redis de formulários e mantém o cache de fontes aquecido.
 *
 * A sincronização pode falhar com o banco fora sem impedir a leitura da fila.
 * O item só sai do Redis depois que a mesma rota pública o processa com sucesso;
 * se o processo cair entre criar e remover, o external_id estável transforma a
 * repetição em duplicado normal pelo índice uniq_crm_leads_org_source_external.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { processarWebhookReservado } from "@/app/api/v1/webhooks/in/[token]/route";
import { fail, ok } from "@/lib/api/wrappers";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { adquirirJanelaDeSyncDeFontes, drenarReservaWebhook } from "@/lib/webhooks/lead-reserve";
import { sincronizarCacheDeFontesWebhook } from "@/lib/webhooks/source-cache";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function autorizado(req: NextRequest): boolean {
  const auth = req.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  const accepted = [env.INTERNAL_CRON_SECRET, env.INTERNAL_SECRET].filter(Boolean);
  return accepted.length > 0 && provided.length > 0 && accepted.includes(provided);
}

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  if (!autorizado(req)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  let cache = { organizations: 0, sources: 0, refreshed: false };
  try {
    if (await adquirirJanelaDeSyncDeFontes()) {
      const refreshed = await sincronizarCacheDeFontesWebhook(createAdminClient());
      cache = { ...refreshed, refreshed: true };
    }
  } catch (error) {
    logger.warn("[webhook-lead-reserve] source cache refresh failed", {
      requestId,
      error: error instanceof Error ? error.message : "unknown_error",
    });
  }

  try {
    const drain = await drenarReservaWebhook(processarWebhookReservado);
    return ok({ ...drain, cache }, { requestId });
  } catch (error) {
    logger.error("[webhook-lead-reserve] drain failed", {
      requestId,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return fail("internal_error", "Failed to drain webhook lead reserve.", 500, { requestId });
  }
}

export function GET(req: NextRequest): Promise<Response> {
  return handle(req);
}

export function POST(req: NextRequest): Promise<Response> {
  return handle(req);
}
