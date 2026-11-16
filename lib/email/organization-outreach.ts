import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Resend } from "resend";
import { z } from "zod";
/** Credencial exclusiva da organização em .env dedicado, somente na instalação.
 * Sem fallback para o remetente/chave global de outra empresa. Nunca loga valores. */
export async function sendOrganizationOutreach(input: { organizationId: string; to: string; subject: string; text: string; idempotencyKey: string }): Promise<boolean> {
 if (!z.string().uuid().safeParse(input.organizationId).success) return false;
 let source: string;
 try { source = await readFile(join(process.env.PROACTIVITY_EMAIL_ENV_DIR || "/etc/crm/org-email", input.organizationId + ".env"), "utf8"); } catch { return false; }
 const values: Record<string,string> = {};
 for (const line of source.split(/\r?\n/)) {
  const match = /^(RESEND_API_KEY|FROM_EMAIL)=(.*)$/.exec(line.trim());
  if (match) values[match[1]!] = match[2]!.replace(/^(["'])(.*)\1$/, "$2");
 }
 if (!values.RESEND_API_KEY || !z.email().safeParse(values.FROM_EMAIL).success || !z.email().safeParse(input.to).success) return false;
 try {
  const result = await new Resend(values.RESEND_API_KEY).emails.send({ from: values.FROM_EMAIL!, to: input.to, subject: input.subject, text: input.text }, { idempotencyKey: input.idempotencyKey });
  return !result.error;
 } catch { return false; }
}
