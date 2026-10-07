import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ResultadoJuncaoAutomatica {
  juntados: number;
  ignorados_por_risco: number;
}

function resultadoSeguro(data: unknown): ResultadoJuncaoAutomatica {
  const value = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  return {
    juntados: typeof value.juntados === "number" ? value.juntados : 0,
    ignorados_por_risco:
      typeof value.ignorados_por_risco === "number" ? value.ignorados_por_risco : 0,
  };
}

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

  const admin = createAdminClient();
  const { data, error } = await admin.rpc(
    "fn_juntar_duplicados_recentes" as never,
    { p_lote: 50 } as never,
  );
  if (error) {
    logger.error("[juntar-duplicados] lote falhou", {
      error: error.message,
      requestId,
    });
    return fail("internal_error", "Failed to merge recent duplicate leads.", 500, {
      requestId,
    });
  }

  const result = resultadoSeguro(data);
  if (result.juntados > 0) {
    void audit({
      action: "lead.duplicate_merged",
      organizationId: null,
      bypassedRls: true,
      requestId,
      metadata: {
        actor: "sistema",
        reason: "junção automática: formulário e WhatsApp do mesmo contato em até 2 minutos",
        ...result,
      },
    });
  }

  return ok(result, { requestId });
}

export async function GET(req: NextRequest): Promise<Response> {
  return handle(req);
}

export async function POST(req: NextRequest): Promise<Response> {
  return handle(req);
}
