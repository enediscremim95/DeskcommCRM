import { resolveField } from "@/lib/automation/conditions";
import { PACING_DEFAULTS } from "@/lib/agent-engine/pacing/defaults";
import { horaLocalNoFuso } from "@/lib/agent-engine/pacing/engine";

const ALIASES: Record<string, string> = {
  nome: "contact.name",
  telefone: "contact.phone_number",
  email: "contact.email",
};

function primeiroNome(context: Record<string, unknown>): string {
  const resolved = resolveField(context, "contact.name");
  if (typeof resolved !== "string") return "";
  const primeiraPalavra = resolved.trim().split(/\s+/)[0] ?? "";
  if (!primeiraPalavra) return "";
  return (
    primeiraPalavra.slice(0, 1).toLocaleUpperCase("pt-BR") +
    primeiraPalavra.slice(1).toLocaleLowerCase("pt-BR")
  );
}

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
  const firstName = primeiroNome(context);
  const semVirgulaPendente = firstName
    ? template
    : template.replace(/,\s*\{\{\s*primeiro_nome\s*\}\}/g, "");
  return semVirgulaPendente.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, path: string) => {
    if (path === "saudacao") return saudacaoPorHorario(now, timezone);
    if (path === "primeiro_nome") return firstName;
    const resolved = resolveField(context, ALIASES[path] ?? path);
    return resolved === undefined || resolved === null ? "" : String(resolved);
  });
}
