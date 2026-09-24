import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function hashExtensionSecret(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function novoCodigoDePareamento(): string {
  return randomBytes(12).toString("base64url");
}

export function novoTokenDaExtensao(): string {
  return `ext_${randomBytes(32).toString("base64url")}`;
}

export function segredoConfere(raw: string, expectedHash: string): boolean {
  const atual = Buffer.from(hashExtensionSecret(raw), "hex");
  const esperado = Buffer.from(expectedHash, "hex");
  return atual.length === esperado.length && timingSafeEqual(atual, esperado);
}
