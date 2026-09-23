"use server";

import { headers } from "next/headers";

import { createAdminClient } from "@/lib/supabase/admin";
import { forgotPasswordSchema, type ForgotPasswordInput } from "@/lib/auth/schemas";
import { audit, hashEmail } from "@/lib/audit";
import { authRateLimited, AUTH_LIMITS } from "@/lib/auth/rate-limit";
import { marcaDaSaida } from "@/lib/branding/saida";
import { isEmailConfigured, sendEmail } from "@/lib/email/resend";
import { buildPasswordResetEmail } from "@/lib/email/templates/password-reset";
import { env } from "@/lib/env";
import { normalizarIdioma } from "@/lib/i18n/idiomas";

export type RequestPasswordResetResult =
  | { ok: true }
  | {
      ok: false;
      error: "validation_error" | "rate_limited" | "email_not_configured" | "request_failed";
      details?: Record<string, unknown>;
    };

/**
 * Gera o token pelo GoTrue Admin e envia o nosso próprio e-mail pelo Resend.
 * A resposta continua neutra quanto à existência da conta: e-mail desconhecido
 * não recebe nada e devolve o mesmo sucesso de uma conta existente.
 */
export async function requestPasswordReset(
  input: ForgotPasswordInput,
): Promise<RequestPasswordResetResult> {
  const parsed = forgotPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "validation_error",
      details: parsed.error.flatten().fieldErrors,
    };
  }

  const hdrs = await headers();
  // Nunca montar um link com o header Origin: esta Action é pública e o header
  // pode ser forjado para fazer o e-mail apontar o token para outro domínio.
  const origin = env.NEXT_PUBLIC_APP_URL;
  const requestId = hdrs.get("x-request-id");
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = hdrs.get("user-agent") ?? null;

  // Sem teto, este endpoint é uma metralhadora de e-mail contra terceiros e um
  // oráculo de enumeração de conta. Issue #64.
  if (await authRateLimited("reset", parsed.data.email, AUTH_LIMITS.reset)) {
    return { ok: false, error: "rate_limited" };
  }

  const emailHash = hashEmail(parsed.data.email);
  const auditFailure = async (reason: string) =>
    audit({
      action: "auth.password_reset_request_failed",
      metadata: { email_hash: emailHash, reason },
      requestId,
      ip,
      userAgent,
    });

  if (!isEmailConfigured()) {
    await auditFailure("email_not_configured");
    return { ok: false, error: "email_not_configured" };
  }

  const confirmUrl = new URL("/auth/confirm", origin);
  confirmUrl.searchParams.set("type", "recovery");

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email: parsed.data.email,
    options: { redirectTo: confirmUrl.toString() },
  });

  if (error) {
    // O Admin é explícito para conta inexistente. Converter só ESTE código em
    // sucesso mantém a neutralidade sem esconder indisponibilidade real.
    if (error.code === "user_not_found") {
      await audit({
        action: "auth.password_reset_requested",
        metadata: { email_hash: emailHash },
        requestId,
        ip,
        userAgent,
      });
      return { ok: true };
    }
    if (error.status === 429 || error.code === "over_request_rate_limit") {
      await auditFailure("rate_limited");
      return { ok: false, error: "rate_limited" };
    }
    await auditFailure("link_generation_failed");
    return { ok: false, error: "request_failed" };
  }

  const tokenHash = data.properties.hashed_token;
  if (!tokenHash) {
    await auditFailure("link_generation_failed");
    return { ok: false, error: "request_failed" };
  }

  confirmUrl.searchParams.set("token_hash", tokenHash);
  const marca = await marcaDaSaida(null);
  const idioma = normalizarIdioma(
    typeof data.user.user_metadata?.locale === "string"
      ? data.user.user_metadata.locale
      : undefined,
  );
  const mensagem = buildPasswordResetEmail({
    resetUrl: confirmUrl.toString(),
    marca,
    idioma,
  });
  const sent = await sendEmail({
    to: parsed.data.email,
    ...mensagem,
    fromName: marca.nome,
    tags: [{ name: "tipo", value: "password-reset" }],
  });

  if (!sent.ok) {
    await auditFailure(sent.error ?? "send_failed");
    if (sent.error === "not_configured") {
      return { ok: false, error: "email_not_configured" };
    }
    if (sent.error === "rate_limited") {
      return { ok: false, error: "rate_limited" };
    }
    return { ok: false, error: "request_failed" };
  }

  await audit({
    action: "auth.password_reset_requested",
    metadata: { email_hash: emailHash },
    requestId,
    ip,
    userAgent,
  });

  return { ok: true };
}
