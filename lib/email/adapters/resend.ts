import { Resend } from "resend";

import { env } from "@/lib/env";

import { classificarErroEmail, type EmailAdapter } from "../types";

let client: Resend | null = null;

function getClient(): Resend | null {
  if (client) return client;
  const key = env.RESEND_API_KEY;
  if (!key || key.length < 10) return null;
  client = new Resend(key);
  return client;
}

export const resendAdapter: EmailAdapter = {
  isConfigured() {
    return getClient() !== null;
  },

  async send(args, from) {
    const resend = getClient();
    if (!resend) return { ok: false, error: "not_configured" };

    try {
      const { data, error } = await resend.emails.send(
        {
          from,
          to: args.to,
          subject: args.subject,
          html: args.html,
          text: args.text,
          replyTo: args.replyTo,
          tags: args.tags,
        },
        args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : undefined,
      );

      if (error) {
        return {
          ok: false,
          error: classificarErroEmail(String(error.name || ""), error.message ?? ""),
          details: error.message,
        };
      }
      return { ok: true, id: data?.id };
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: classificarErroEmail(name, message),
        details: message,
      };
    }
  },
};
