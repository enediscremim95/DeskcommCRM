import "server-only";

import { z } from "zod";
import { env } from "@/lib/env";
import {
  buildWindsorUrl,
  isTimeoutError,
  WINDSOR_REQUEST_TIMEOUT_MS,
  type AccountSelection,
  type DateRange,
} from "./request";
import type { AdPlatform, WindsorRow } from "./types";

export { WINDSOR_REQUEST_TIMEOUT_MS } from "./request";
const WINDSOR_LEGACY_REQUEST_TIMEOUT_MS = 180_000;
const responseSchema = z.object({
  data: z.array(z.record(z.string(), z.unknown())).optional(),
  result: z.array(z.record(z.string(), z.unknown())).optional(),
  error: z.unknown().optional(),
}).passthrough();

export class WindsorUnavailableError extends Error {
  constructor(
    public readonly code: "windsor_not_configured" | "windsor_incomplete" | "windsor_http_error" | "windsor_invalid_response" | "windsor_timeout",
    message: string,
  ) {
    super(message);
  }
}

function errorText(value: unknown): string {
  let raw: string;
  if (typeof value === "string") raw = value;
  else {
    try { raw = JSON.stringify(value); } catch { raw = "erro desconhecido"; }
  }
  if (env.WINDSOR_API_KEY) raw = raw.replaceAll(env.WINDSOR_API_KEY, "[REDACTED]");
  return raw.replace(/api_key=[^&\s]+/gi, "api_key=[REDACTED]");
}

async function request(
  fields: readonly string[],
  preset: string,
  legacyAccountId?: string,
  selection?: AccountSelection,
  dateRange?: DateRange,
): Promise<WindsorRow[]> {
  if (!env.WINDSOR_API_KEY) {
    throw new WindsorUnavailableError("windsor_not_configured", "WINDSOR_API_KEY não está configurada nesta instalação.");
  }
  const url = buildWindsorUrl(
    env.WINDSOR_API_KEY,
    fields,
    dateRange ? undefined : preset,
    legacyAccountId,
    selection,
    dateRange,
  );
  const timeoutMs = selection ? WINDSOR_REQUEST_TIMEOUT_MS : WINDSOR_LEGACY_REQUEST_TIMEOUT_MS;

  let response: Response;
  try {
    response = await fetch(url, {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (isTimeoutError(error)) {
      throw new WindsorUnavailableError(
        "windsor_timeout",
        `Windsor não respondeu em ${timeoutMs / 1000} segundos.`,
      );
    }
    throw error;
  }
  if (!response.ok) {
    throw new WindsorUnavailableError("windsor_http_error", `Windsor respondeu HTTP ${response.status}.`);
  }
  const parsed = responseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new WindsorUnavailableError("windsor_invalid_response", "Windsor respondeu em formato inesperado.");
  }
  if (parsed.data.error) {
    const detail = errorText(parsed.data.error);
    if (/incomplete|time-series/i.test(detail)) {
      throw new WindsorUnavailableError("windsor_incomplete", detail);
    }
    throw new WindsorUnavailableError("windsor_http_error", detail.slice(0, 240));
  }
  return parsed.data.data ?? parsed.data.result ?? [];
}

async function withTodayFallback(
  fields: readonly string[],
  days: 30 | 90,
  legacyAccountId?: string,
  selection?: AccountSelection,
) {
  try {
    return await request(fields, `last_${days}dT`, legacyAccountId, selection);
  } catch (error) {
    if (error instanceof WindsorUnavailableError && error.code === "windsor_incomplete") {
      return request(fields, `last_${days}d`, legacyAccountId, selection);
    }
    throw error;
  }
}

export const fetchWindsorRows = (fields: readonly string[], accountId?: string) =>
  withTodayFallback(fields, 90, accountId);
export const fetchWindsorRows30d = (fields: readonly string[], accountId?: string) =>
  withTodayFallback(fields, 30, accountId);

export const fetchWindsorAccountRows = (
  fields: readonly string[],
  accountId: string,
  platform: AdPlatform,
) => withTodayFallback(fields, 90, undefined, { accountId, platform });

export const fetchWindsorCampaignReach = (
  accountId: string,
  range: DateRange,
) => request(
  ["account_id", "campaign_id", "campaign", "reach"],
  "",
  undefined,
  { accountId, platform: "meta_ads" },
  range,
);
