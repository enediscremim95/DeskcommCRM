import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { assertDestinoResolvidoSeguro } from "@/lib/automation/outbound-ip";
import { assertSafeOutboundUrl } from "@/lib/automation/outbound-url";
import { encryptWebhookSecret, decryptWebhookSecret } from "@/lib/webhooks/secrets";

import { ARCHIVED_AT } from "./archived";
import { CHANNEL_PROVIDER_EVOLUTION, CHANNEL_PROVIDER_WAHA } from "./capabilities";

export const MANAGED_QR_CONNECTOR_LABEL = "Evolution API";
export const MANAGED_QR_EXPIRES_SECONDS = 60;

type RemoteState = "open" | "close" | "connecting";

interface ManagedConnectorRow {
  id: string;
  organization_id: string;
  evolution_base_url: string;
  evolution_instance_name: string;
  evolution_api_key_encrypted: string;
  evolution_reconnect_hook_url: string | null;
  evolution_remote_state: RemoteState | null;
  evolution_qr_attempt_count: number;
  evolution_hook_last_status: string | null;
  evolution_hook_last_error: string | null;
  evolution_hook_last_attempt_at: string | null;
  phone_number: string | null;
  display_name: string | null;
}

export interface ManagedConnectorSafe {
  id: string;
  provider_label: string;
  base_url: string;
  instance_name: string;
  phone_number: string;
  display_name: string | null;
  has_api_key: boolean;
  reconnect_hook_url: string | null;
  remote_state: RemoteState | null;
  qr_attempts: number;
  hook_last_status: string | null;
  hook_last_error: string | null;
  hook_last_attempt_at: string | null;
}

export class ManagedConnectorError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly retryAfterSeconds?: number,
  ) {
    super(code);
  }
}

export function managedConnectorAdminErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    managed_connector_key_required: "Informe a chave da instância na primeira configuração.",
    managed_connector_waha_conflict: "Esta organização ainda tem uma sessão por QR ativa. Arquive-a antes de mudar o conector.",
    managed_connector_encryption_unavailable: "A cifra de credenciais não está configurada nesta instalação.",
  };
  return messages[code] ?? "Não foi possível salvar o conector.";
}

function normalizeBaseUrl(value: string): string {
  const parsed = new URL(value);
  assertSafeOutboundUrl(parsed.toString());
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function safe(row: ManagedConnectorRow): ManagedConnectorSafe {
  return {
    id: row.id,
    provider_label: MANAGED_QR_CONNECTOR_LABEL,
    base_url: row.evolution_base_url,
    instance_name: row.evolution_instance_name,
    phone_number: row.phone_number ?? "",
    display_name: row.display_name,
    has_api_key: Boolean(row.evolution_api_key_encrypted),
    reconnect_hook_url: row.evolution_reconnect_hook_url,
    remote_state: row.evolution_remote_state,
    qr_attempts: row.evolution_qr_attempt_count,
    hook_last_status: row.evolution_hook_last_status,
    hook_last_error: row.evolution_hook_last_error,
    hook_last_attempt_at: row.evolution_hook_last_attempt_at,
  };
}

const MANAGED_COLUMNS = [
  "id",
  "organization_id",
  "evolution_base_url",
  "evolution_instance_name",
  "evolution_api_key_encrypted",
  "evolution_reconnect_hook_url",
  "evolution_remote_state",
  "evolution_qr_attempt_count",
  "evolution_hook_last_status",
  "evolution_hook_last_error",
  "evolution_hook_last_attempt_at",
  "phone_number",
  "display_name",
].join(", ");

async function loadRow(admin: SupabaseClient, organizationId: string): Promise<ManagedConnectorRow | null> {
  const { data, error } = await admin
    .from("channel_sessions")
    .select(MANAGED_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("provider", CHANNEL_PROVIDER_EVOLUTION)
    .is(ARCHIVED_AT, null)
    .maybeSingle();
  if (error) throw new ManagedConnectorError("managed_connector_lookup_failed", 500);
  return (data as unknown as ManagedConnectorRow | null) ?? null;
}

export async function findManagedConnector(
  admin: SupabaseClient,
  organizationId: string,
): Promise<ManagedConnectorSafe | null> {
  const row = await loadRow(admin, organizationId);
  return row ? safe(row) : null;
}

export async function hasManagedConnector(admin: SupabaseClient, organizationId: string): Promise<boolean> {
  return Boolean(await loadRow(admin, organizationId));
}

export async function saveManagedConnector(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    baseUrl: string;
    instanceName: string;
    phoneNumber: string;
    displayName?: string | null;
    apiKey?: string | null;
    reconnectHookUrl?: string | null;
  },
): Promise<ManagedConnectorSafe> {
  const existing = await loadRow(admin, input.organizationId);
  const apiKey = input.apiKey?.trim() || null;
  if (!existing && !apiKey) throw new ManagedConnectorError("managed_connector_key_required", 422);

  const { data: conflicting } = await admin
    .from("channel_sessions")
    .select("id")
    .eq("organization_id", input.organizationId)
    .eq("provider", CHANNEL_PROVIDER_WAHA)
    .is(ARCHIVED_AT, null)
    .limit(1);
  if ((conflicting?.length ?? 0) > 0) {
    throw new ManagedConnectorError("managed_connector_waha_conflict", 409);
  }

  const encryptedKey = apiKey ? await encryptWebhookSecret(admin, apiKey) : null;
  if (apiKey && !encryptedKey) throw new ManagedConnectorError("managed_connector_encryption_unavailable", 422);

  const baseUrl = normalizeBaseUrl(input.baseUrl.trim());
  const reconnectHookUrl = input.reconnectHookUrl?.trim() || null;
  if (reconnectHookUrl) assertSafeOutboundUrl(reconnectHookUrl);

  const values: Record<string, unknown> = {
    organization_id: input.organizationId,
    provider: CHANNEL_PROVIDER_EVOLUTION,
    evolution_base_url: baseUrl,
    evolution_instance_name: input.instanceName.trim(),
    evolution_reconnect_hook_url: reconnectHookUrl,
    phone_number: input.phoneNumber.replace(/\D/g, ""),
    display_name: input.displayName?.trim() || MANAGED_QR_CONNECTOR_LABEL,
    status: existing?.evolution_remote_state === "open" ? "WORKING" : "STOPPED",
    status_reason: existing?.evolution_remote_state === "open" ? null : "remote_state_pending",
    archived_at: null,
  };
  if (encryptedKey) values.evolution_api_key_encrypted = encryptedKey;

  if (!existing) {
    const webhookSecret = await encryptWebhookSecret(admin, randomUUID());
    if (!webhookSecret) throw new ManagedConnectorError("managed_connector_encryption_unavailable", 422);
    values.webhook_path_token = randomUUID().replace(/-/g, "");
    values.webhook_secret_encrypted = webhookSecret;
    values.evolution_api_key_encrypted = encryptedKey;
    values.waha_session_name = null;
  }

  const query = existing
    ? admin
        .from("channel_sessions")
        .update(values)
        .eq("organization_id", input.organizationId)
        .eq("id", existing.id)
    : admin.from("channel_sessions").insert(values);
  const { error } = await query;
  if (error) {
    if (error.message.includes("channel_connector_conflict")) {
      throw new ManagedConnectorError("managed_connector_waha_conflict", 409);
    }
    throw new ManagedConnectorError("managed_connector_save_failed", 500);
  }

  const saved = await loadRow(admin, input.organizationId);
  if (!saved) throw new ManagedConnectorError("managed_connector_save_failed", 500);
  return safe(saved);
}

async function credentials(admin: SupabaseClient, organizationId: string): Promise<{
  row: ManagedConnectorRow;
  apiKey: string;
}> {
  const row = await loadRow(admin, organizationId);
  if (!row) throw new ManagedConnectorError("managed_connector_not_found", 404);
  const apiKey = await decryptWebhookSecret(admin, row.evolution_api_key_encrypted);
  if (!apiKey) throw new ManagedConnectorError("managed_connector_key_unavailable", 503);
  return { row, apiKey };
}

async function assertRemoteUrlSafe(baseUrl: string): Promise<void> {
  assertSafeOutboundUrl(baseUrl);
  await assertDestinoResolvidoSeguro(new URL(baseUrl).hostname);
}

export async function readManagedConnectorState(
  admin: SupabaseClient,
  organizationId: string,
  request: typeof fetch = fetch,
): Promise<{ connector: ManagedConnectorSafe; transitionedToOpen: boolean }> {
  const { row, apiKey } = await credentials(admin, organizationId);
  await assertRemoteUrlSafe(row.evolution_base_url);
  const response = await request(
    `${row.evolution_base_url}/instance/connectionState/${encodeURIComponent(row.evolution_instance_name)}`,
    { headers: { apikey: apiKey }, cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(10_000) },
  );
  if (!response.ok) throw new ManagedConnectorError("managed_connector_state_failed", 502);
  const body = (await response.json().catch(() => null)) as { instance?: { state?: string } } | null;
  const state = body?.instance?.state;
  if (state !== "open" && state !== "close" && state !== "connecting") {
    throw new ManagedConnectorError("managed_connector_invalid_state", 502);
  }

  const { data, error } = await admin.rpc("fn_record_managed_channel_state", {
    p_org: organizationId,
    p_session: row.id,
    p_state: state,
  });
  if (error) throw new ManagedConnectorError("managed_connector_state_persist_failed", 500);
  const transition = Array.isArray(data) ? data[0] : data;
  const transitionedToOpen = Boolean(transition?.transitioned_to_open);
  const refreshed = await loadRow(admin, organizationId);
  if (!refreshed) throw new ManagedConnectorError("managed_connector_not_found", 404);
  return { connector: safe(refreshed), transitionedToOpen };
}

export async function requestManagedConnectorQr(
  admin: SupabaseClient,
  organizationId: string,
  request: typeof fetch = fetch,
): Promise<{ qr_base64: string | null; code: string | null; pairing_code: string | null; expires_in: number; attempts: number }> {
  const { row, apiKey } = await credentials(admin, organizationId);
  const { data, error } = await admin.rpc("fn_reserve_managed_channel_qr", {
    p_org: organizationId,
    p_session: row.id,
  });
  if (error) throw new ManagedConnectorError("managed_connector_qr_reservation_failed", 500);
  const reservation = Array.isArray(data) ? data[0] : data;
  if (!reservation?.allowed) {
    const exhausted = Number(reservation?.attempts ?? 0) >= 3 && Number(reservation?.retry_after_seconds ?? 0) === 0;
    throw new ManagedConnectorError(
      exhausted ? "managed_connector_qr_attempts_exhausted" : "managed_connector_qr_rate_limited",
      429,
      exhausted ? undefined : Number(reservation?.retry_after_seconds ?? 60),
    );
  }

  await assertRemoteUrlSafe(row.evolution_base_url);
  const response = await request(
    `${row.evolution_base_url}/instance/connect/${encodeURIComponent(row.evolution_instance_name)}`,
    { headers: { apikey: apiKey }, cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(10_000) },
  );
  if (!response.ok) throw new ManagedConnectorError("managed_connector_qr_failed", 502);
  const body = (await response.json().catch(() => null)) as {
    base64?: string;
    code?: string;
    pairingCode?: string;
  } | null;
  return {
    qr_base64: typeof body?.base64 === "string" ? body.base64 : null,
    code: typeof body?.code === "string" ? body.code : null,
    pairing_code: typeof body?.pairingCode === "string" ? body.pairingCode : null,
    expires_in: MANAGED_QR_EXPIRES_SECONDS,
    attempts: Number(reservation.attempts ?? 1),
  };
}

export async function notifyManagedConnectorRecovered(
  admin: SupabaseClient,
  organizationId: string,
  request: typeof fetch = fetch,
): Promise<{ status: "skipped" | "success" | "failed"; error: string | null }> {
  const row = await loadRow(admin, organizationId);
  if (!row?.evolution_reconnect_hook_url) return { status: "skipped", error: null };
  let status: "success" | "failed" = "failed";
  let error: string | null = null;
  try {
    assertSafeOutboundUrl(row.evolution_reconnect_hook_url);
    await assertDestinoResolvidoSeguro(new URL(row.evolution_reconnect_hook_url).hostname);
    const response = await request(row.evolution_reconnect_hook_url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "whatsapp.reconnected", occurred_at: new Date().toISOString() }),
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`http_${response.status}`);
    status = "success";
  } catch (cause) {
    error = cause instanceof Error ? cause.message.slice(0, 200) : "hook_failed";
  }
  await admin
    .from("channel_sessions")
    .update({
      evolution_hook_last_status: status,
      evolution_hook_last_error: error,
      evolution_hook_last_attempt_at: new Date().toISOString(),
    })
    .eq("organization_id", organizationId)
    .eq("id", row.id);
  return { status, error };
}
