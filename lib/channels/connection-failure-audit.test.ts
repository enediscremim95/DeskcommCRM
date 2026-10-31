import { beforeEach, describe, expect, it, vi } from "vitest";

import { audit } from "@/lib/audit";
import { auditChannelConnectionFailure } from "./connection-failure-audit";

vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/auth/server", () => ({
  loadAuthUser: vi.fn(),
  resolveActiveOrg: vi.fn(),
}));

const organizationId = "20000000-0000-4000-8000-000000000001";
const userId = "20000000-0000-4000-8000-000000000002";
const requestId = "20000000-0000-4000-8000-000000000003";

describe("auditoria da falha de conexão", () => {
  beforeEach(() => vi.clearAllMocks());

  it("grava só o detalhe técnico permitido e nunca leva segredo ou QR", () => {
    auditChannelConnectionFailure({
      organizationId,
      userId,
      requestId,
      reason: "connection_repair_required",
      origin: "connections",
      technical: {
        operation: "start",
        http_status: 502,
        waha_api_key: "waha-secret-value",
        webhook_token: "webhook-secret-value",
        qr: "data:image/png;base64,qr-secret-value",
        message: "request failed with token-secret-value",
      },
    });

    expect(audit).toHaveBeenCalledWith({
      action: "channel.connect_failed",
      actorUserId: userId,
      organizationId,
      resourceType: "channel_session",
      requestId,
      metadata: {
        reason: "connection_repair_required",
        origin: "connections",
        technical: { operation: "start", http_status: 502 },
      },
    });
    const recorded = JSON.stringify(vi.mocked(audit).mock.calls);
    expect(recorded).not.toContain("waha-secret-value");
    expect(recorded).not.toContain("webhook-secret-value");
    expect(recorded).not.toContain("qr-secret-value");
    expect(recorded).not.toContain("token-secret-value");
  });
});
