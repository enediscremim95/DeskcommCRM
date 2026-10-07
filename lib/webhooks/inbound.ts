/**
 * Parsing do inbound de captação: field_map → lead normalizado + HMAC.
 * Sem I/O — puro, testável. A rota (webhooks/in/[token]) faz o resto.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import { canonicalPhoneBR } from "@/lib/channels/phone-variants";

export interface FieldMap {
  name?: string[];
  phone?: string[];
  email?: string[];
}

const DEFAULT_FIELD_MAP: Required<FieldMap> = {
  name: ["name", "nome", "full_name", "fullname"],
  phone: ["phone", "telefone", "whatsapp", "celular", "phone_number", "tel"],
  email: ["email", "e-mail", "mail"],
};

export interface MappedLead {
  name: string | null;
  phone: string | null;
  email: string | null;
  custom_fields: Record<string, string>;
  source_metadata: Record<string, string>;
}

function dddBrasileiroValido(digits: string): boolean {
  return /^[1-9]\d$/.test(digits.slice(0, 2));
}

/** Normaliza UMA grafia, sem tentar reparar quantidade de dígitos. */
function normalizarUmaCopia(digitsRaw: string, internacional: boolean): string | null {
  let digits = digitsRaw;
  if (internacional) {
    return /^\d{8,15}$/.test(digits) ? canonicalPhoneBR(`+${digits}`) : null;
  }

  // Prefixo nacional de tronco: 0 + DDD + número. Não cobre 0 + operadora.
  if (
    (digits.length === 11 || digits.length === 12) &&
    digits.startsWith("0") &&
    dddBrasileiroValido(digits.slice(1))
  ) {
    digits = digits.slice(1);
  }

  let e164: string | null = null;
  if (digits.length === 12 || digits.length === 13) {
    e164 = digits.startsWith("55") ? `+${digits}` : null;
  } else if (digits.length === 10 || digits.length === 11) {
    e164 = `+55${digits}`;
  }
  return e164 ? canonicalPhoneBR(e164) : null;
}

/**
 * Cópias reconhecíveis sem heurística de tamanho:
 *
 * - número completo duas vezes;
 * - DDI uma vez e o número nacional/local duas vezes, como +55 N N ou +34 N N.
 *
 * Se mais de uma decomposição produzir telefones diferentes, a entrada continua
 * ambígua e não é aceita.
 */
function normalizarDuplicacao(digits: string, internacional: boolean): string | null {
  const candidatas: Array<{ digits: string; internacional: boolean }> = [];

  if (digits.length % 2 === 0) {
    const metade = digits.length / 2;
    if (digits.slice(0, metade) === digits.slice(metade)) {
      candidatas.push({ digits: digits.slice(0, metade), internacional });
    }
  }

  const tamanhosDeDdi = internacional ? [1, 2, 3] : digits.startsWith("55") ? [2] : [];
  for (const tamanhoDoDdi of tamanhosDeDdi) {
    const restante = digits.slice(tamanhoDoDdi);
    if (restante.length % 2 !== 0) continue;
    const metade = restante.length / 2;
    if (restante.slice(0, metade) !== restante.slice(metade)) continue;
    candidatas.push({
      digits: digits.slice(0, tamanhoDoDdi + metade),
      internacional,
    });
  }

  const normalizadas = new Set(
    candidatas
      .map((copia) => normalizarUmaCopia(copia.digits, copia.internacional))
      .filter((phone): phone is string => phone !== null),
  );
  return normalizadas.size === 1 ? [...normalizadas][0]! : null;
}

/** Normaliza telefone para E.164, sem inventar DDD ou corrigir tamanho. */
export function normalizePhoneBR(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");
  const internacional = trimmed.startsWith("+") || trimmed.startsWith("±");

  return (
    normalizarUmaCopia(digits, internacional) ??
    normalizarDuplicacao(digits, internacional)
  );
}

function firstMatch(payload: Record<string, unknown>, aliases: string[]): { key: string; value: string } | null {
  const lowered = new Map(Object.keys(payload).map((k) => [k.toLowerCase(), k]));
  for (const alias of aliases) {
    const key = lowered.get(alias.toLowerCase());
    if (key !== undefined) {
      const v = payload[key];
      if (typeof v === "string" && v.trim()) return { key, value: v.trim() };
    }
  }
  return null;
}

export function mapInboundPayload(
  payload: Record<string, unknown>,
  fieldMap: FieldMap = {},
): MappedLead {
  const map: Required<FieldMap> = {
    name: [...(fieldMap.name ?? []), ...DEFAULT_FIELD_MAP.name],
    phone: [...(fieldMap.phone ?? []), ...DEFAULT_FIELD_MAP.phone],
    email: [...(fieldMap.email ?? []), ...DEFAULT_FIELD_MAP.email],
  };

  const nameHit = firstMatch(payload, map.name);
  const phoneHit = firstMatch(payload, map.phone);
  const emailHit = firstMatch(payload, map.email);
  const consumed = new Set([nameHit?.key, phoneHit?.key, emailHit?.key].filter(Boolean));

  const custom_fields: Record<string, string> = {};
  const source_metadata: Record<string, string> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (consumed.has(key)) continue;
    const str =
      typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : null;
    if (str === null) continue; // objetos/arrays aninhados: descartados no v1
    const chave = key.toLowerCase();
    if (chave.startsWith("utm_") || chave === "pagina" || chave === "origem") {
      source_metadata[chave] = str;
    }
    else custom_fields[key] = str;
  }

  return {
    name: nameHit?.value ?? null,
    phone: normalizePhoneBR(phoneHit?.value),
    email: emailHit?.value ?? null,
    custom_fields,
    source_metadata,
  };
}

/** HMAC SHA-256 hex do raw body. Header: X-Deskcomm-Signature. */
export function verifyInboundSignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(header, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
