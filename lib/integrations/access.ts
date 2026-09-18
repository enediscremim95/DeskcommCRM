import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  CLOSED_INTEGRATION_ACCESS,
  INTEGRATION_SLUGS,
  type IntegrationAccessMap,
  type IntegrationSlug,
} from "./types";

type AdminClient = ReturnType<typeof createAdminClient>;

export async function integrationAccessForOrganization(
  admin: AdminClient,
  organizationId: string,
): Promise<IntegrationAccessMap> {
  const access = structuredClone(CLOSED_INTEGRATION_ACCESS);
  const { data, error } = await admin
    .from("organization_integration_permissions" as never)
    .select("integration,client_visible,client_can_reconnect")
    .eq("organization_id", organizationId);

  if (error || !data) return access;
  for (const row of data as unknown as Array<{
    integration: string;
    client_visible: boolean;
    client_can_reconnect: boolean;
  }>) {
    if (!INTEGRATION_SLUGS.includes(row.integration as IntegrationSlug)) continue;
    const integration = row.integration as IntegrationSlug;
    access[integration] = {
      client_visible: row.client_visible === true,
      client_can_reconnect:
        integration === "whatsapp" && row.client_visible === true && row.client_can_reconnect === true,
    };
  }
  return access;
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
