import { createHash } from "node:crypto";

/**
 * Identifica somente o conjunto de organizações acessíveis, sem expor os IDs
 * ao navegador. A ordenação torna a assinatura independente da ordem da query.
 */
export function assinaturaDosAcessosAsOrganizacoes(organizationIds: readonly string[]): string {
  const ids = [...organizationIds].sort();
  const hash = createHash("sha256").update(ids.join("\n")).digest("hex");
  return `${ids.length}:${hash}`;
}
