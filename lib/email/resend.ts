/**
 * Fachada de e-mail transacional.
 *
 * O caminho e a interface pública permanecem estáveis para os chamadores
 * existentes. A seleção do transporte fica contida aqui e Resend continua
 * sendo o padrão para não quebrar instalações já publicadas.
 */
import { resendAdapter } from "@/lib/email/adapters/resend";
import { sesAdapter } from "@/lib/email/adapters/ses";
import type { EmailAdapter, SendArgs, SendResult } from "@/lib/email/types";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

function provider(): { name: "resend" | "ses"; adapter: EmailAdapter } {
  return env.EMAIL_PROVIDER === "ses"
    ? { name: "ses", adapter: sesAdapter }
    : { name: "resend", adapter: resendAdapter };
}

function enderecoDoProvider(): string {
  return env.EMAIL_PROVIDER === "ses" ? env.SES_FROM_EMAIL : env.RESEND_FROM_EMAIL;
}

/**
 * `null` = não há remetente utilizável. Nunca inventa um domínio do produto.
 * O nome é sanitizado porque vem da marca configurável da instalação.
 */
export function fromAddress(fromName?: string): string | null {
  const endereco = enderecoDoProvider().trim();
  if (endereco.length === 0) return null;
  const nome = (fromName ?? "").replace(/[<>"\r\n]/g, "").trim();
  return nome.length > 0 ? `${nome} <${endereco}>` : endereco;
}

function detalhesSeguros(details?: string): string | undefined {
  return details?.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]").slice(0, 500);
}

export async function sendEmail(args: SendArgs): Promise<SendResult> {
  const selected = provider();
  const from = fromAddress(args.fromName);
  const result: SendResult =
    from && selected.adapter.isConfigured()
      ? await selected.adapter.send(args, from)
      : { ok: false as const, error: "not_configured" as const };

  if (!result.ok) {
    // Nunca registra destinatário, assunto ou corpo: e-mail pode conter credenciais.
    logger.error("Falha no envio de e-mail", {
      provider: selected.name,
      motivo: result.error,
      detalhes: detalhesSeguros(result.details),
    });
  }

  return result;
}

export function isEmailConfigured(): boolean {
  const selected = provider();
  return selected.adapter.isConfigured() && fromAddress() !== null;
}
