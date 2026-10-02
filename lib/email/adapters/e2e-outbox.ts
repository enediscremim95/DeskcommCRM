import { appendFile, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import * as path from "node:path";

import { env } from "@/lib/env";

import type { EmailAdapter } from "../types";

export const E2E_EMAIL_OUTBOX = ".e2e-email-outbox.jsonl";

interface E2EOutboxMessage {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
}

function isLocalUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname;
    return hostname === "127.0.0.1" || hostname === "localhost";
  } catch {
    return false;
  }
}

function destinatarios(to: string | string[]): string[] {
  return Array.isArray(to) ? to : [to];
}

function falhaPedida(to: string | string[]): boolean {
  const prefixo = env.E2E_EMAIL_FAIL_TO_PREFIX.trim();
  return prefixo.length > 0 && destinatarios(to).some((email) => email.startsWith(prefixo));
}

/** Lê a entrega sintética sem depender do Mailpit do GoTrue. */
export async function findE2EOutboxEmail(
  to: string,
  subjectPart: string,
): Promise<string | null> {
  let raw: string;
  try {
    raw = await readFile(path.join(process.cwd(), E2E_EMAIL_OUTBOX), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }

  for (const line of raw.trim().split("\n").reverse()) {
    if (line.length === 0) continue;
    try {
      const message = JSON.parse(line) as E2EOutboxMessage;
      if (
        destinatarios(message.to).includes(to) &&
        message.subject.includes(subjectPart)
      ) {
        return message.html || message.text || null;
      }
    } catch {
      // Uma leitura pode coincidir com o append. A próxima sondagem relê a linha completa.
    }
  }
  return null;
}

/**
 * Caixa de saída do Playwright.
 *
 * Só fica disponível quando app E banco são locais. Assim o transporte que
 * prova entrega no E2E não pode ser ligado por engano numa instalação real.
 */
export const e2eOutboxAdapter: EmailAdapter = {
  isConfigured() {
    return (
      env.EMAIL_PROVIDER === "e2e" &&
      isLocalUrl(env.NEXT_PUBLIC_APP_URL) &&
      isLocalUrl(env.NEXT_PUBLIC_SUPABASE_URL)
    );
  },

  async send(args, from) {
    if (!this.isConfigured()) return { ok: false, error: "not_configured" };
    if (falhaPedida(args.to)) return { ok: false, error: "send_failed" };

    try {
      const id = `e2e-${randomUUID()}`;
      await appendFile(
        path.join(process.cwd(), E2E_EMAIL_OUTBOX),
        `${JSON.stringify({ id, from, ...args })}\n`,
        "utf8",
      );
      return { ok: true, id };
    } catch (error) {
      return {
        ok: false,
        error: "send_failed",
        details: error instanceof Error ? error.message : String(error),
      };
    }
  },
};
