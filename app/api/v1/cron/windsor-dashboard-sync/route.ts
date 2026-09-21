import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api/wrappers";
import { env } from "@/lib/env";
import { syncTrafficDashboards } from "@/lib/windsor/sync";

export const dynamic = "force-dynamic";
function authorized(request: NextRequest): boolean {
  // Aceita as DUAS, como event-log-drain e agent-dispatcher: o scheduler manda
  // INTERNAL_SECRET, e `CRON || SECRET` recusava o scheduler sempre que as duas
  // existiam e eram diferentes. Medido em produção (21/09/2026): as rodadas de
  // 3 em 3 horas levavam 401 calado e os dashboards ficavam até 13 h sem sincronizar.
  const aceitos = [env.INTERNAL_CRON_SECRET, env.INTERNAL_SECRET].filter(Boolean);
  const header = request.headers.get("authorization") ?? "";
  return aceitos.length > 0 && aceitos.some((segredo) => header === `Bearer ${segredo}`);
}
async function handler(request: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  if (!authorized(request)) return fail("unauthorized", "cron secret inválido", 401, { requestId });
  try {
    const result = await syncTrafficDashboards({ trigger: "cron" });
    return ok(result, { requestId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha na sincronização Windsor.";
    return fail("cron_failed", message.slice(0, 300), 500, { requestId });
  }
}
export const GET = handler;
export const POST = handler;
