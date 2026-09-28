export const INTEGRATION_SLUGS = ["whatsapp", "n8n", "windsor"] as const;

export type IntegrationSlug = (typeof INTEGRATION_SLUGS)[number];

export interface IntegrationPermission {
  client_visible: boolean;
  client_can_reconnect: boolean;
}

export type IntegrationAccessMap = Record<IntegrationSlug, IntegrationPermission>;

export const DEFAULT_INTEGRATION_ACCESS: IntegrationAccessMap = {
  whatsapp: { client_visible: true, client_can_reconnect: true },
  n8n: { client_visible: true, client_can_reconnect: false },
  windsor: { client_visible: true, client_can_reconnect: false },
};

export interface IntegrationPermissionRow {
  integration: string;
  client_visible: boolean;
  client_can_reconnect: boolean;
}

export function integrationAccessFromRows(
  rows: IntegrationPermissionRow[],
): IntegrationAccessMap {
  const access = structuredClone(DEFAULT_INTEGRATION_ACCESS);
  for (const row of rows) {
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
