import { z } from "zod";

export const proactivePolicySchema = z.object({
  enabled: z.boolean().default(false),
  max_attempts: z.number().int().min(1).max(5).default(2),
  start_hour: z.number().int().min(0).max(23).default(9),
  end_hour: z.number().int().min(1).max(24).default(18),
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).default([1,2,3,4,5]),
  timezone: z.string().refine((v) => { try { new Intl.DateTimeFormat("en", { timeZone: v }); return true; } catch { return false; } }).default("America/Sao_Paulo"),
}).refine((v) => v.start_hour < v.end_hour, { path: ["end_hour"], message: "O fim deve ser posterior ao início." });
export type ProactivePolicy = z.infer<typeof proactivePolicySchema>;
export function proactivePolicy(settings: unknown): ProactivePolicy {
  const raw = settings && typeof settings === "object" ? (settings as Record<string, unknown>).proactive_followup : undefined;
  const parsed = proactivePolicySchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : proactivePolicySchema.parse({});
}
export function proactiveDecision(p: ProactivePolicy, input: { now: Date; lastInbound: string | null; attempts: number }): string | null {
  if (!p.enabled) return "disabled";
  const inbound = input.lastInbound ? Date.parse(input.lastInbound) : NaN;
  const elapsed = input.now.getTime() - inbound;
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= 24 * 60 * 60 * 1000) return "outside_whatsapp_window";
  if (input.attempts >= p.max_attempts) return "attempt_limit";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: p.timezone, weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(input.now).map((v) => [v.type, v.value]));
  const day = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].indexOf(parts.weekday!);
  if (!p.weekdays.includes(day) || Number(parts.hour) < p.start_hour || Number(parts.hour) >= p.end_hour) return "outside_business_hours";
  return null;
}
