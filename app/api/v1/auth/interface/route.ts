import { randomUUID } from "node:crypto";
import { requireRole } from "@/lib/auth/require-role";
import { assinaturaDosAcessosAsOrganizacoes } from "@/lib/auth/assinatura-acessos-organizacoes";
import { lerInterface } from "@/lib/navigation/interface";
import { ok } from "@/lib/api/wrappers";
export const dynamic = "force-dynamic";
/** Somente contexto próprio. Payload de Realtime invalida, nunca autoriza. */
export async function GET() {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "interface" });
  if (!authz.ok) return authz.response;
  const settings = lerInterface(authz.org.interface_settings).settings;
  // `loadAuthUser`, chamado por `requireRole`, monta esta lista com filtro
  // explícito por `user_id` e sem vínculos revogados. O endpoint devolve só
  // contagem + hash: o vigia detecta a mudança sem receber IDs ou nomes.
  const organizationIds = authz.user.organizations.map((org) => org.organization_id);
  const response = ok(
    {
      organization_id: authz.org.orgId,
      interface_settings: settings,
      signature: JSON.stringify(settings),
      organizations_count: organizationIds.length,
      organizations_signature: assinaturaDosAcessosAsOrganizacoes(organizationIds),
    },
    { requestId },
  );
  response.headers.set("Cache-Control", "no-store");
  return response;
}
