import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/** Segredo transitório: AES-GCM, chave derivada com domínio próprio e AAD por org.
 * A senha cifrada sobrevive a falhas de envio; o banco a apaga após aceite pelo e-mail.
 * Não depende da chave opcional de IA. Rotacionar INTERNAL_SECRET invalida pendências.
 */
function key(secret: string) {
  if (secret.length < 16) throw new Error("Segredo interno insuficiente");
  return Buffer.from(hkdfSync("sha256", secret, "", "crm-owner-access-v1", 32));
}
export function sealOwnerPassword(password: string, secret: string, organizationId: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  cipher.setAAD(Buffer.from(organizationId));
  const data = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
}
export function openOwnerPassword(value: string, secret: string, organizationId: string): string {
  const packed = Buffer.from(value, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key(secret), packed.subarray(0, 12));
  decipher.setAAD(Buffer.from(organizationId));
  decipher.setAuthTag(packed.subarray(12, 28));
  return Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString("utf8");
}
