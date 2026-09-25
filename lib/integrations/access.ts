import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import {
  DEFAULT_INTEGRATION_ACCESS,
  integrationAccessFromRows,
  type IntegrationAccessMap,
  type IntegrationPermissionRow,
  type IntegrationSlug,
} from "./types";

type AdminClient = ReturnType<typeof createAdminClient>;

export async function integrationAccessForOrganization(
  admin: AdminClient,
  organizationId: string,
): Promise<IntegrationAccessMap> {
  const access = structuredClone(DEFAULT_INTEGRATION_ACCESS);
  const { data, error } = await admin
    .from("organization_integration_permissions" as never)
    .select("integration,client_visible,client_can_reconnect")
    .eq("organization_id", organizationId);

  if (error || !data) return access;
  return integrationAccessFromRows(data as unknown as IntegrationPermissionRow[]);
}

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
