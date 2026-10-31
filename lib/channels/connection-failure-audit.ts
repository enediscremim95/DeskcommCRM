import { audit } from "@/lib/audit";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";

export type ConnectionOrigin =
  | "connections"
  | "onboarding"
  | "managed_connector"
  | "reconnect"
  | "disconnect"
  | "delete";

interface ConnectionFailureAuditInput {
  organizationId: string;
  userId: string;
  requestId: string;
  reason: string;
  origin: ConnectionOrigin;
  channelSessionId?: string;
  technical?: Record<string, unknown>;
}

/**
 * O detalhe técnico do erro do WAHA tem dois campos úteis e não secretos.
 * A allowlist é deliberada: copiar um objeto de erro inteiro para auditoria
 * faria uma futura chave, URL assinada, token ou conteúdo de QR vazar sem que
 * este caminho percebesse.
 */
function safeTechnical(
  technical: Record<string, unknown> | undefined,
): Record<string, string | number> | undefined {
  if (!technical) return undefined;
  const safe: Record<string, string | number> = {};
  if (
    typeof technical.operation === "string" &&
    ["create", "start", "stop", "logout", "delete"].includes(technical.operation)
  ) {
    safe.operation = technical.operation;
  }
  if (
    typeof technical.http_status === "number" &&
    Number.isInteger(technical.http_status) &&
    technical.http_status >= 100 &&
    technical.http_status <= 599
  ) {
    safe.http_status = technical.http_status;
  }
  return Object.keys(safe).length > 0 ? safe : undefined;
}

export function auditChannelConnectionFailure(input: ConnectionFailureAuditInput): void {
  const technical = safeTechnical(input.technical);
  void audit({
    action: "channel.connect_failed",
    actorUserId: input.userId,
    organizationId: input.organizationId,
    resourceType: "channel_session",
    requestId: input.requestId,
    metadata: {
      reason: input.reason,
      origin: input.origin,
      ...(input.channelSessionId ? { channel_session_id: input.channelSessionId } : {}),
      ...(technical ? { technical } : {}),
    },
  });
}

async function responseErrorCode(response: Response): Promise<string> {
  try {
    const body = (await response.clone().json()) as { error?: { code?: unknown } };
    if (typeof body.error?.code === "string" && body.error.code.length > 0) {
      return body.error.code;
    }
  } catch {
    // A resposta original segue intacta. O fallback ainda deixa um motivo estável.
  }
  return `http_${response.status}`;
}

/**
 * Recusas anteriores ao retorno de requireRole ainda precisam da identidade
 * confiável da sessão. Falhar ao recuperá-la nunca pode substituir a resposta
 * original por um erro de auditoria.
 */
export async function auditActiveConnectionRefusal(input: {
  response: Response;
  requestId: string;
  origin: ConnectionOrigin;
}): Promise<void> {
  try {
    const user = await loadAuthUser();
    if (!user) return;
    const org = await resolveActiveOrg(user);
    if (!org) return;
    auditChannelConnectionFailure({
      organizationId: org.orgId,
      userId: user.id,
      requestId: input.requestId,
      reason: await responseErrorCode(input.response),
      origin: input.origin,
    });
  } catch {
    // Auditoria é fire-and-forget por contrato e não muda a recusa original.
  }
}
