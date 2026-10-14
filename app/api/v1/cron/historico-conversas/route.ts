import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { executarRodadaHistorico } from "@/lib/channels/historico";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authorization = req.headers.get("authorization") ?? "";
  const provided = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  const accepted = [env.INTERNAL_CRON_SECRET, env.INTERNAL_SECRET].filter(Boolean);
  if (accepted.length === 0 || !provided || !accepted.includes(provided)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  try {
    const resultado = await executarRodadaHistorico({
      habilitado: env.HISTORICO_WHATSAPP_ENABLED.trim().toLowerCase() !== "false",
    });
    for (const [organizationId, inseridas] of Object.entries(resultado.efeitosPorOrganizacao)) {
      if (inseridas <= 0) continue;
      void audit({
        action: "conversation.history_imported",
        organizationId,
        bypassedRls: true,
        requestId,
        metadata: { actor: "sistema", mensagens_inseridas: inseridas },
      });
    }
    return ok(resultado, { requestId });
  } catch (err) {
    logger.error("historico.canal: rodada falhou", {
      requestId,
      detail: err instanceof Error ? err.message : String(err),
    });
    return fail("internal_error", "Failed to import conversation history.", 500, { requestId });
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  return handle(req);
}

export async function POST(req: NextRequest): Promise<Response> {
  return handle(req);
}
