import { resolveField } from "@/lib/automation/conditions";
import { PACING_DEFAULTS } from "@/lib/agent-engine/pacing/defaults";
import { horaLocalNoFuso } from "@/lib/agent-engine/pacing/engine";

const ALIASES: Record<string, string> = {
  nome: "contact.name",
  telefone: "contact.phone_number",
  email: "contact.email",
};

export interface RenderTemplateOptions {
  now?: Date;
  timezone?: string;
}

function saudacaoPorHorario(now: Date, timezone: string): string {
  const hour = horaLocalNoFuso(now, timezone);
  if (hour < 12) return "Ótimo dia";
  if (hour < 18) return "Ótima tarde";
  return "Ótima noite";
}

export function renderTemplate(
  template: string,
  context: Record<string, unknown>,
  options: RenderTemplateOptions = {},
): string {
  const now = options.now ?? new Date();
  const timezone = options.timezone ?? PACING_DEFAULTS.timezone;
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, path: string) => {
    if (path === "saudacao") return saudacaoPorHorario(now, timezone);
    const resolved = resolveField(context, ALIASES[path] ?? path);
    return resolved === undefined || resolved === null ? "" : String(resolved);
  });
}
