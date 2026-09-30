import { appendFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import * as path from "node:path";

import { env } from "@/lib/env";

import type { EmailAdapter } from "../types";

export const E2E_EMAIL_OUTBOX = ".e2e-email-outbox.jsonl";

function isLocalUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname;
    return hostname === "127.0.0.1" || hostname === "localhost";
  } catch {
    return false;
  }
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
