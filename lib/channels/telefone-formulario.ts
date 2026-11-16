import { canonicalPhoneBR, phoneLookupVariants } from "./phone-variants";
import type { ChannelSessionRef } from "./session-ref";
import { getWahaClient } from "@/lib/waha/client";
/** Só correções estruturais inequívocas. Dígito arbitrário não identifica uma pessoa. */
export function corrigirTelefoneFormulario(raw: string): string | null {
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("0055")) d = d.slice(2);
  if (d.startsWith("5555") && d.length >= 14) d = d.slice(2);
  if (/^0[1-9][0-9][0-9]{8,9}$/.test(d)) d = d.slice(1);
  if (/^55[1-9][0-9]99[6-9][0-9]{7}$/.test(d)) d = d.slice(0, 4) + d.slice(5);
  if (!raw.trim().startsWith("+") && /^[1-9][0-9][2-9][0-9]{7,8}$/.test(d)) d = `55${d}`;
  const normalized = canonicalPhoneBR(d);
  return /^\+55[1-9][0-9](?:[2-5][0-9]{7}|9[6-9][0-9]{7})$/.test(normalized) ? normalized : null;
}
export async function validarTelefoneFormulario(
  raw: string,
  session: ChannelSessionRef,
): Promise<string | null> {
  const candidate = corrigirTelefoneFormulario(raw);
  if (!candidate || session.provider !== "waha") return null;
  const client = getWahaClient();
  if (!client) return null;
  for (const v of phoneLookupVariants(candidate)) {
    const r = await client.checkContactExists(session.waha_session_name, v.replace(/\D/g, ""));
    if (r.numberExists) return candidate;
  }
  return null;
}
