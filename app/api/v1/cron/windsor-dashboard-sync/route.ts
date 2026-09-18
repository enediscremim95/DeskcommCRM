import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api/wrappers";
import { env } from "@/lib/env";
import { syncTrafficDashboards } from "@/lib/windsor/sync";

export const dynamic = "force-dynamic";
function authorized(request: NextRequest): boolean {
  const expected = env.INTERNAL_CRON_SECRET || env.INTERNAL_SECRET;
  return Boolean(expected) && request.headers.get("authorization") === `Bearer ${expected}`;
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
