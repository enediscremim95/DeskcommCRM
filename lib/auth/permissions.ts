import { ROLE_RANK, type ActiveOrg, type AuthUser, type Role } from "@/lib/auth/types";

/**
 * Mapa canônico das permissões semânticas usadas pela API e pela interface.
 *
 * `resource.delete` cobre apagar, arquivar, cancelar ou desconectar um recurso
 * persistente. Comandos operacionais que apenas encerram uma ação em curso
 * (desligar a própria chamada, cancelar snooze, remover a própria assinatura
 * push) não são exclusão de recurso e mantêm o gate específico da operação.
 */
export const PERMISSION_MIN_ROLE = {
  "inbox.view": "viewer",
  "inbox.reply": "agent",
  "inbox.claim": "agent",
  "contact.view": "viewer",
  "contact.create": "agent",
  "contact.update": "agent",
  "contact.delete": "manager",
  "resource.delete": "manager",
  "pipeline.view": "viewer",
  "pipeline.create": "manager",
  "pipeline.move_card": "agent",
  "settings.write": "admin",
  "lgpd.execute_redact": "admin",
  "audit.view": "manager",
  "ai.automatico.view": "agent",
  "ai.inbox.view": "agent",
  "inbox.notes.view": "agent",
  "message-templates.view": "agent",
  "ai.agents.view": "manager",
  "ai.agents.write": "admin",
  "ai.memory.view": "manager",
  "ai.memory.publish": "admin",
  "ai.skills.view": "manager",
  "ai.skills.manage": "manager",
  "ai.routers.view": "manager",
  "ai.evolution.view": "manager",
  "ai.routers.manage": "admin",
  "ai.credentials.view": "manager",
  "ai.credentials.write": "admin",
  "webhooks.manage": "manager",
  "voice.call": "agent",
} as const satisfies Record<string, Role>;

/**
 * Capacidades que NÃO cabem na escada de papéis.
 *
 * Gerente e administrador têm o mesmo piso para o acesso geral, mas somente o
 * gerente pode gerir a equipe e excluir leads. O administrador de plataforma
 * é tratado separadamente porque não é um papel da organização.
 */
export const PERMISSION_ROLES = {
  // Excluir lead é o ÚNICO poder que o administrador da organização não tem.
  // Decisão do dono do produto (25/09/2026): "tem o acesso do gerente, que
  // inclui adicionar e remover pessoas e excluir leads, e tem o adm, que não
  // pode excluir leads". Gerir equipe ficou com os dois de propósito: ele
  // restringiu exclusão, não a gestão de pessoas.
  "lead.delete": ["manager"],
  "team.manage": ["manager", "admin"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSION_MIN_ROLE | keyof typeof PERMISSION_ROLES;

export function minimumRoleForPermission(permission: Permission): Role | null {
  return permission in PERMISSION_MIN_ROLE
    ? PERMISSION_MIN_ROLE[permission as keyof typeof PERMISSION_MIN_ROLE]
    : null;
}

export function roleHasPermission(role: Role, permission: Permission): boolean {
  if (permission in PERMISSION_ROLES) {
    return (PERMISSION_ROLES[permission as keyof typeof PERMISSION_ROLES] as readonly Role[]).includes(
      role,
    );
  }
  const minimumRole = minimumRoleForPermission(permission);
  return minimumRole !== null && ROLE_RANK[role] >= ROLE_RANK[minimumRole];
}

/** Mesma decisão semântica usada por páginas servidoras e pelo contexto React. */
export function userHasPermission(
  user: Pick<AuthUser, "is_platform_admin" | "support">,
  activeOrg: Pick<ActiveOrg, "role"> | null,
  permission: Permission,
): boolean {
  if (user.is_platform_admin && !user.support) return true;
  return !!activeOrg && roleHasPermission(activeOrg.role, permission);
}

/** Detecta remoção disfarçada de atualização por substituição de uma lista. */
export function replacementRemovesValues(
  previous: readonly string[],
  next: readonly string[],
): boolean {
  const nextValues = new Set(next);
  return previous.some((value) => !nextValues.has(value));
}
