import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  headers: vi.fn(),
  generateLink: vi.fn(),
  rateLimited: vi.fn(),
  audit: vi.fn(),
  isEmailConfigured: vi.fn(),
  sendEmail: vi.fn(),
  marcaDaSaida: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: h.headers }));
vi.mock("@/lib/env", () => ({ env: { NEXT_PUBLIC_APP_URL: "https://crm.exemplo.test" } }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ auth: { admin: { generateLink: h.generateLink } } }),
}));
vi.mock("@/lib/auth/rate-limit", () => ({
  authRateLimited: h.rateLimited,
  AUTH_LIMITS: { reset: { ip: 30, id: 3, windowSec: 3600 } },
}));
vi.mock("@/lib/audit", () => ({
  audit: h.audit,
  hashEmail: () => "hash-do-email",
}));
vi.mock("@/lib/email/resend", () => ({
  isEmailConfigured: h.isEmailConfigured,
  sendEmail: h.sendEmail,
}));
vi.mock("@/lib/branding/saida", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  marcaDaSaida: h.marcaDaSaida,
}));

import { requestPasswordReset } from "./requestPasswordReset";

const EMAIL = "pessoa@exemplo.test";
const TOKEN_HASH = "hash-secreto-do-token";
const MARCA = {
  nome: "Acme",
  logoUrl: null,
  accent: "#234567",
  accentFg: "#ffffff",
  origens: { nome: "instalacao", cor: "instalacao" },
};

function linkGerado(locale = "pt-BR") {
  return {
    data: {
      properties: { hashed_token: TOKEN_HASH },
      user: { user_metadata: { locale } },
    },
    error: null,
  };
}

describe("requestPasswordReset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.headers.mockResolvedValue({
      get: (name: string) =>
        name === "origin"
          ? "https://atacante.exemplo.test"
          : name === "x-request-id"
            ? "req-123"
            : null,
    });
    h.rateLimited.mockResolvedValue(false);
    h.isEmailConfigured.mockReturnValue(true);
    h.generateLink.mockResolvedValue(linkGerado("es"));
    h.marcaDaSaida.mockResolvedValue(MARCA);
    h.sendEmail.mockResolvedValue({ ok: true, id: "email-1" });
    h.audit.mockResolvedValue(undefined);
  });

  it("gera recovery pelo Admin e envia pelo Resend com token_hash, sem PKCE", async () => {
    await expect(requestPasswordReset({ email: EMAIL })).resolves.toEqual({ ok: true });

    expect(h.generateLink).toHaveBeenCalledWith({
      type: "recovery",
      email: EMAIL,
      options: {
        redirectTo: "https://crm.exemplo.test/auth/confirm?type=recovery",
      },
    });
    expect(h.sendEmail).toHaveBeenCalledTimes(1);
    const envio = h.sendEmail.mock.calls[0]?.[0];
    expect(envio.to).toBe(EMAIL);
    expect(envio.text).toContain(
      `https://crm.exemplo.test/auth/confirm?type=recovery&token_hash=${TOKEN_HASH}`,
    );
    expect(envio.text).not.toContain("code=");
    expect(envio.subject).toContain("Crea una nueva contraseña");
  });

  it("e-mail desconhecido recebe a mesma resposta e não dispara envio", async () => {
    h.generateLink.mockResolvedValue({
      data: { properties: null, user: null },
      error: { code: "user_not_found", status: 404, message: "User not found" },
    });

    await expect(requestPasswordReset({ email: EMAIL })).resolves.toEqual({ ok: true });
    expect(h.sendEmail).not.toHaveBeenCalled();
    expect(h.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "auth.password_reset_requested",
        metadata: { email_hash: "hash-do-email" },
      }),
    );
  });

  it("sem provedor configurado falha claramente e não gera token", async () => {
    h.isEmailConfigured.mockReturnValue(false);

    await expect(requestPasswordReset({ email: EMAIL })).resolves.toEqual({
      ok: false,
      error: "email_not_configured",
    });
    expect(h.generateLink).not.toHaveBeenCalled();
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it("mantém o teto de tentativas antes de gerar ou enviar", async () => {
    h.rateLimited.mockResolvedValue(true);

    await expect(requestPasswordReset({ email: EMAIL })).resolves.toEqual({
      ok: false,
      error: "rate_limited",
    });
    expect(h.generateLink).not.toHaveBeenCalled();
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it("não grava link, token nem detalhe do provedor na auditoria de falha", async () => {
    h.sendEmail.mockResolvedValue({
      ok: false,
      error: "send_failed",
      details: `falhou ao enviar ${TOKEN_HASH}`,
    });

    await expect(requestPasswordReset({ email: EMAIL })).resolves.toEqual({
      ok: false,
      error: "request_failed",
    });
    const auditoria = JSON.stringify(h.audit.mock.calls);
    expect(auditoria).not.toContain(TOKEN_HASH);
    expect(auditoria).not.toContain("/auth/confirm");
    expect(auditoria).toContain("send_failed");
  });
});
