export const INTEGRATION_SLUGS = ["whatsapp", "n8n", "windsor"] as const;

export type IntegrationSlug = (typeof INTEGRATION_SLUGS)[number];

export interface IntegrationPermission {
  client_visible: boolean;
  client_can_reconnect: boolean;
}

export type IntegrationAccessMap = Record<IntegrationSlug, IntegrationPermission>;

export const CLOSED_INTEGRATION_ACCESS: IntegrationAccessMap = {
  whatsapp: { client_visible: false, client_can_reconnect: false },
  n8n: { client_visible: false, client_can_reconnect: false },
  windsor: { client_visible: false, client_can_reconnect: false },
};
