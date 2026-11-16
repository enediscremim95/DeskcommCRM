import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { verifiedGoogleStatus } from "./connection-health";
import { contaDaAgendaPrimaria } from "./calendarios";
import { decryptWebhookSecret } from "@/lib/webhooks/secrets";
import { recordGoogleConnectionFailure } from "./fallback";
vi.mock("./calendarios", () => ({ contaDaAgendaPrimaria: vi.fn() }));
vi.mock("@/lib/webhooks/secrets", () => ({ decryptWebhookSecret: vi.fn() }));
vi.mock("./fallback", () => ({ recordGoogleConnectionFailure: vi.fn() }));
function database(status = "healthy") {
  const q = {
    select: vi.fn(() => q),
    eq: vi.fn(() => q),
    maybeSingle: vi.fn(async () => ({
      data: { status, oauth_access_token_encrypted: "encrypted" },
      error: null,
    })),
  };
  return { db: { from: vi.fn(() => q) } as unknown as SupabaseClient, q };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(decryptWebhookSecret).mockResolvedValue("synthetic-token");
  vi.mocked(recordGoogleConnectionFailure).mockResolvedValue();
});
describe("saúde comprovada da conexão Google", () => {
  it("só retorna saudável após leitura real e restringe organização e conexão", async () => {
    vi.mocked(contaDaAgendaPrimaria).mockResolvedValue({
      ok: true,
      conta: { email: "test@example.invalid", fuso: "UTC" },
    });
    const { db, q } = database();
    expect(await verifiedGoogleStatus(db, "org-a", "connection-a")).toBe("healthy");
    expect(q.eq).toHaveBeenCalledWith("organization_id", "org-a");
    expect(q.eq).toHaveBeenCalledWith("id", "connection-a");
    expect(contaDaAgendaPrimaria).toHaveBeenCalledWith("synthetic-token");
  });
  it("401 invalida a saúde salva e registra a necessidade de reconexão", async () => {
    vi.mocked(contaDaAgendaPrimaria).mockResolvedValue({
      ok: false,
      erro: { status: 401 },
      detalhe: "HTTP 401",
    });
    const { db } = database();
    expect(await verifiedGoogleStatus(db, "org-a", "connection-a")).toBe("token_expired");
    expect(recordGoogleConnectionFailure).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ organizationId: "org-a", connectionId: "connection-a" }),
    );
  });
  it("timeout não é saúde e não derruba a agenda", async () => {
    vi.mocked(contaDaAgendaPrimaria).mockRejectedValue(new Error("timeout"));
    expect(await verifiedGoogleStatus(database().db, "org-a", "connection-a")).toBe("error");
  });
  it("token indecifrável não é declarado saudável", async () => {
    vi.mocked(decryptWebhookSecret).mockResolvedValue(null);
    expect(await verifiedGoogleStatus(database().db, "org-a", "connection-a")).toBe("error");
    expect(contaDaAgendaPrimaria).not.toHaveBeenCalled();
  });
  it("conexão já expirada permanece assim sem chamadas externas", async () => {
    expect(await verifiedGoogleStatus(database("token_expired").db, "org-a", "connection-a")).toBe(
      "token_expired",
    );
    expect(contaDaAgendaPrimaria).not.toHaveBeenCalled();
  });
});
