import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import {
  comCacheDeAcessoAsIntegracoes,
  invalidarCacheDeAcessoAsIntegracoes,
} from "./access-cache";
import {
  integrationAccessFromRows,
  type IntegrationAccessMap,
  type IntegrationPermissionRow,
  type IntegrationSlug,
} from "./types";

type AdminClient = ReturnType<typeof createAdminClient>;

async function lerDoBanco(
  admin: AdminClient,
  organizationId: string,
): Promise<IntegrationAccessMap | null> {
  const { data, error } = await admin
    .from("organization_integration_permissions" as never)
    .select("integration,client_visible,client_can_reconnect")
    .eq("organization_id", organizationId);

  // Erro mantém o fallback histórico, mas não pode aquecer o cache: uma queda
  // momentânea do banco não vira configuração aberta por mais 30 segundos.
  if (error || !data) return null;
  return integrationAccessFromRows(data as unknown as IntegrationPermissionRow[]);
}

export async function integrationAccessForOrganization(
  admin: AdminClient,
  organizationId: string,
): Promise<IntegrationAccessMap> {
  return comCacheDeAcessoAsIntegracoes(
    organizationId,
    () => lerDoBanco(admin, organizationId),
  );
}

export { invalidarCacheDeAcessoAsIntegracoes };

export async function clientCanViewIntegration(
  admin: AdminClient,
  organizationId: string,
  integration: IntegrationSlug,
): Promise<boolean> {
  return (await integrationAccessForOrganization(admin, organizationId))[integration].client_visible;
}

export async function clientCanReconnectWhatsapp(
  admin: AdminClient,
  organizationId: string,
): Promise<boolean> {
  const permission = (await integrationAccessForOrganization(admin, organizationId)).whatsapp;
  return permission.client_visible && permission.client_can_reconnect;
}
