import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok } from "@/lib/api/wrappers";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { fetchWindsorRows30d } from "@/lib/windsor/client";
import { accountId } from "@/lib/windsor/normalizer";
import { CONVERSION_FIELDS } from "@/lib/windsor/types";

export const dynamic = "force-dynamic";
const querySchema = z.object({ account_id: z.string().trim().min(1).max(128) });
const FIELDS = ["account_id", "campaign_name", "campaign_objective", "spend", "cost", ...CONVERSION_FIELDS] as const;

function numeric(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

export async function GET(request: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  try { await requirePlatformAdmin(); } catch {
    return fail("forbidden", "Platform admin required", 403, { requestId });
  }
  const parsed = querySchema.safeParse({ account_id: new URL(request.url).searchParams.get("account_id") });
  if (!parsed.success) return fail("validation_error", "Conta inválida.", 400, { requestId });
  try {
    const rows = (await fetchWindsorRows30d(FIELDS, parsed.data.account_id))
      .filter((row) => accountId(row) === parsed.data.account_id);
    const totals = Object.fromEntries(CONVERSION_FIELDS.map((field) => [
      field, rows.reduce((sum, row) => sum + numeric(row[field]), 0),
    ]));
    const objectives = [...new Set(rows.map((row) => row.campaign_objective).filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    ))];
    return ok({
      account_id: parsed.data.account_id,
      objectives,
      fields: Object.entries(totals).map(([field, total]) => ({ field, total }))
        .sort((a, b) => b.total - a.total),
    }, { requestId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao detectar conversões.";
    return fail("upstream_unavailable", message.slice(0, 300), 503, { requestId });
  }
}
