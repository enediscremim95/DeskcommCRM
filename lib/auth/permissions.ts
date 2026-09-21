import { ROLE_RANK, type Role } from "@/lib/auth/types";

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
  "team.invite": "admin",
  "team.change_role": "admin",
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

export type Permission = keyof typeof PERMISSION_MIN_ROLE;

export function minimumRoleForPermission(permission: Permission): Role {
  return PERMISSION_MIN_ROLE[permission];
}

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimumRoleForPermission(permission)];
}

/** Detecta remoção disfarçada de atualização por substituição de uma lista. */
export function replacementRemovesValues(
  previous: readonly string[],
  next: readonly string[],
): boolean {
  const nextValues = new Set(next);
  return previous.some((value) => !nextValues.has(value));
}
