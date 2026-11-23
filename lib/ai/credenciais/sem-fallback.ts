import { logger } from "@/lib/logger";

export const AVISO_SEM_CREDENCIAL_PROPRIA =
  "A chave compartilhada está bloqueada. Valide uma chave própria para este fornecedor.";

export class CredencialPropriaObrigatoriaError extends Error {
  override readonly name = "llm_own_credential_required";

  constructor(
    organizationId: string,
    reason: "settings_unavailable" | "binding_unavailable" | "credential_unavailable",
    context: { provider?: string; purpose?: string } = {},
  ) {
    super(AVISO_SEM_CREDENCIAL_PROPRIA);
    logger.warn("Chamada de IA interrompida antes do envio", {
      code: this.name,
      organization_id: organizationId,
      reason,
      ...context,
    });
  }
}
