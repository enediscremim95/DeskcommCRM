import type { SupabaseClient } from "@supabase/supabase-js";

export const DEFAULT_URGENT_BATCH_WINDOW_MINUTES = 60;
export const DEFAULT_URGENT_DAILY_LIMIT = 6;

export interface EmailNotificationPolicy {
  urgent_batch_window_minutes: number;
  urgent_daily_limit: number;
}

function inteiroNoIntervalo(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
    ? value
    : fallback;
}

export function parseEmailNotificationPolicy(settings: unknown): EmailNotificationPolicy {
  const root =
    settings && typeof settings === "object" ? (settings as Record<string, unknown>) : {};
  const notifications =
    root.notifications && typeof root.notifications === "object"
      ? (root.notifications as Record<string, unknown>)
      : {};
  const email =
    notifications.email && typeof notifications.email === "object"
      ? (notifications.email as Record<string, unknown>)
      : {};

  return {
    urgent_batch_window_minutes: inteiroNoIntervalo(
      email.urgent_batch_window_minutes,
      DEFAULT_URGENT_BATCH_WINDOW_MINUTES,
      5,
      1_440,
    ),
    urgent_daily_limit: inteiroNoIntervalo(
      email.urgent_daily_limit,
      DEFAULT_URGENT_DAILY_LIMIT,
      1,
      24,
    ),
  };
}

export async function readEmailNotificationPolicy(
  db: SupabaseClient,
  organizationId: string,
): Promise<EmailNotificationPolicy> {
  const { data, error } = await db
    .from("organizations")
    .select("settings")
    .eq("id", organizationId)
    .maybeSingle();
  if (error) throw error;
  return parseEmailNotificationPolicy(data?.settings);
}
