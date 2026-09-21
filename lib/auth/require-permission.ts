import { minimumRoleForPermission, type Permission } from "@/lib/auth/permissions";
import { requireRole } from "@/lib/auth/require-role";

/** Gate de rota que mantém a API na mesma matriz semântica usada pela tela. */
export function requirePermission(
  permission: Permission,
  opts: Parameters<typeof requireRole>[1] = {},
) {
  return requireRole(minimumRoleForPermission(permission), opts);
}
