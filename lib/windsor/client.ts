import "server-only";

import { z } from "zod";
import { env } from "@/lib/env";
import type { WindsorRow } from "./types";

const ENDPOINT = "https://connectors.windsor.ai/all";
const responseSchema = z.object({
  data: z.array(z.record(z.string(), z.unknown())).optional(),
  result: z.array(z.record(z.string(), z.unknown())).optional(),
  error: z.unknown().optional(),
}).passthrough();

export class WindsorUnavailableError extends Error {
  constructor(
    public readonly code: "windsor_not_configured" | "windsor_incomplete" | "windsor_http_error" | "windsor_invalid_response",
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

async function request(fields: readonly string[], preset: string, accountId?: string): Promise<WindsorRow[]> {
  if (!env.WINDSOR_API_KEY) {
    throw new WindsorUnavailableError("windsor_not_configured", "WINDSOR_API_KEY não está configurada nesta instalação.");
  }
  const url = new URL(ENDPOINT);
  url.searchParams.set("api_key", env.WINDSOR_API_KEY);
  url.searchParams.set("date_preset", preset);
  url.searchParams.set("fields", fields.join(","));
  if (accountId) url.searchParams.set("account_id", accountId);

  const response = await fetch(url, {
    cache: "no-store",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(180_000),
  });
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

async function withTodayFallback(fields: readonly string[], days: 30 | 90, accountId?: string) {
  try {
    return await request(fields, `last_${days}dT`, accountId);
  } catch (error) {
    if (error instanceof WindsorUnavailableError && error.code === "windsor_incomplete") {
      return request(fields, `last_${days}d`, accountId);
    }
    throw error;
  }
}

export const fetchWindsorRows = (fields: readonly string[], accountId?: string) =>
  withTodayFallback(fields, 90, accountId);
export const fetchWindsorRows30d = (fields: readonly string[], accountId?: string) =>
  withTodayFallback(fields, 30, accountId);
