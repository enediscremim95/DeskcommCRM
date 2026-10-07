import { normalizePhoneBR } from "@/lib/webhooks/inbound";

export const TITULO_DE_LEAD_SEM_NOME = "Lead sem nome";

export interface LeadSemContato {
  id: string;
  organization_id: string;
  title: string;
  source_metadata: unknown;
}

export interface PlanoDeRecuperacao {
  leadId: string;
  organizationId: string;
  phone: string;
}

export function rawPhoneDoMetadata(metadata: unknown): string | null {
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) return null;
  const raw = (metadata as Record<string, unknown>).raw_phone;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

export function planejarRecuperacao(lead: LeadSemContato): PlanoDeRecuperacao | null {
  const rawPhone = rawPhoneDoMetadata(lead.source_metadata);
  const phone = normalizePhoneBR(rawPhone);
  if (!phone) return null;
  return {
    leadId: lead.id,
    organizationId: lead.organization_id,
    phone,
  };
}

/** Nome do cadastro novo, sem inventar informação que o lead não trouxe. */
export function nomeDoContatoRecuperado(title: string, phone: string): string {
  const limpo = title.trim();
  return limpo && limpo !== TITULO_DE_LEAD_SEM_NOME ? limpo : phone;
}

/** Só o sentinela genérico pode ser substituído. */
export function tituloDepoisDaRecuperacao(
  title: string,
  contactName: string | null,
  phone: string,
): string | null {
  if (title !== TITULO_DE_LEAD_SEM_NOME) return null;
  return contactName?.trim() || phone;
}

/** Nunca imprime o telefone inteiro: só os quatro últimos dígitos ficam visíveis. */
export function telefoneMascarado(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return "(sem dígitos)";
  const visiveis = digits.slice(-4);
  return `${"*".repeat(Math.max(4, digits.length - visiveis.length))}${visiveis}`;
}
