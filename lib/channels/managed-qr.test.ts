import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("@/lib/automation/outbound-ip", () => ({ assertDestinoResolvidoSeguro: vi.fn() }));
vi.mock("@/lib/automation/outbound-url", () => ({ assertSafeOutboundUrl: vi.fn() }));
vi.mock("@/lib/webhooks/secrets", () => ({
  encryptWebhookSecret: vi.fn(async () => "\\xencrypted"),
  decryptWebhookSecret: vi.fn(async () => "instance-secret"),
}));

import {
  findManagedConnector,
  ManagedConnectorError,
  readManagedConnectorState,
  requestManagedConnectorQr,
} from "./managed-qr";

const row = {
  id: "20000000-0000-4000-8000-000000000002",
  organization_id: "20000000-0000-4000-8000-000000000001",
  evolution_base_url: "https://connector.example",
  evolution_instance_name: "existing-instance",
  evolution_api_key_encrypted: "\\xencrypted",
  evolution_reconnect_hook_url: null,
  evolution_remote_state: "close",
  evolution_qr_attempt_count: 0,
  evolution_hook_last_status: null,
  evolution_hook_last_error: null,
  evolution_hook_last_attempt_at: null,
  phone_number: "5541999999999",
  display_name: "WhatsApp comercial",
};

function fixture(rpcResult?: (name: string) => unknown) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    is: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => ({ data: row, error: null })),
  };
  const db = {
    from: vi.fn(() => chain),
    rpc: vi.fn(async (name: string) => ({ data: rpcResult?.(name) ?? null, error: null })),
  } as unknown as SupabaseClient;
  return { db };
}

beforeEach(() => vi.clearAllMocks());

describe("conector QR gerenciado", () => {
  it("nunca devolve a credencial no DTO seguro", async () => {
    const { db } = fixture();
    const connector = await findManagedConnector(db, row.organization_id);
    expect(connector).toMatchObject({ has_api_key: true, instance_name: "existing-instance" });
    expect(JSON.stringify(connector)).not.toContain("instance-secret");
    expect(JSON.stringify(connector)).not.toContain("encrypted");
  });

  it("consulta somente o estado da mesma instância e persiste a transição", async () => {
    const { db } = fixture((name) => name === "fn_record_managed_channel_state"
      ? [{ transitioned_to_open: true, previous_state: "close" }]
      : null);
    const request = vi.fn(async () => new Response(JSON.stringify({ instance: { state: "open" } }), { status: 200 }));
    const result = await readManagedConnectorState(db, row.organization_id, request as typeof fetch);
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith(
      "https://connector.example/instance/connectionState/existing-instance",
      expect.objectContaining({ headers: { apikey: "instance-secret" }, redirect: "manual" }),
    );
    expect(db.rpc).toHaveBeenCalledWith("fn_record_managed_channel_state", expect.objectContaining({ p_state: "open" }));
    expect(result.transitionedToOpen).toBe(true);
  });

  it("gera QR somente pelo endpoint connect da instância existente", async () => {
    const { db } = fixture((name) => name === "fn_reserve_managed_channel_qr"
      ? [{ allowed: true, retry_after_seconds: 0, attempts: 1 }]
      : null);
    const request = vi.fn(async () => new Response(JSON.stringify({ base64: "png", pairingCode: "12345678" }), { status: 200 }));
    const result = await requestManagedConnectorQr(db, row.organization_id, request as typeof fetch);
    expect(request).toHaveBeenCalledWith(
      "https://connector.example/instance/connect/existing-instance",
      expect.objectContaining({ headers: { apikey: "instance-secret" }, redirect: "manual" }),
    );
    expect(result).toMatchObject({ qr_base64: "png", pairing_code: "12345678", attempts: 1 });
  });

  it("bloqueia no banco a quarta tentativa sem tocar no serviço externo", async () => {
    const { db } = fixture((name) => name === "fn_reserve_managed_channel_qr"
      ? [{ allowed: false, retry_after_seconds: 0, attempts: 3 }]
      : null);
    const request = vi.fn();
    await expect(requestManagedConnectorQr(db, row.organization_id, request as typeof fetch))
      .rejects.toMatchObject({
        code: "managed_connector_qr_attempts_exhausted",
        status: 429,
      } satisfies Partial<ManagedConnectorError>);
    expect(request).not.toHaveBeenCalled();
  });
});
