import { audit } from "@/lib/audit";
import { fail } from "@/lib/api/wrappers";
import {
  minimumRoleForPermission,
  roleHasPermission,
  type Permission,
} from "@/lib/auth/permissions";
import { requireRole, type RequireRoleOpts } from "@/lib/auth/require-role";

/** Gate de rota que mantém a API na mesma matriz semântica usada pela tela. */
export async function requirePermission(
  permission: Permission,
  opts: RequireRoleOpts = {},
) {
  const minimumRole = minimumRoleForPermission(permission);
  if (minimumRole) return requireRole(minimumRole, opts);

  const authz = await requireRole("viewer", { ...opts, allowPlatformAdmin: true });
  if (!authz.ok) return authz;

  if (
    (authz.user.is_platform_admin && !authz.user.support) ||
    roleHasPermission(authz.org.role, permission)
  ) {
    return authz;
  }

  void audit({
    action: "authz.denied",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: opts.resource ?? null,
    requestId: opts.requestId,
    metadata: { required_permission: permission, effective_role: authz.org.role },
  });
  return {
    ok: false as const,
    response: fail(
      "forbidden_role",
      `Permissão insuficiente. Requer capacidade ${permission}.`,
      403,
      { requestId: opts.requestId },
    ),
  };
}
