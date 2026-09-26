import { createHash, createHmac } from "node:crypto";

import { env } from "@/lib/env";

import { classificarErroEmail, type EmailAdapter, type SendArgs } from "../types";

const SERVICE = "ses";
const CONTENT_TYPE = "application/json";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function corpo(args: SendArgs, from: string): string {
  const body: Record<string, unknown> = {
    FromEmailAddress: remetenteSes(from),
    Destination: {
      ToAddresses: Array.isArray(args.to) ? args.to : [args.to],
    },
    Content: {
      Simple: {
        Subject: { Data: args.subject, Charset: "UTF-8" },
        Body: {
          Html: { Data: args.html, Charset: "UTF-8" },
          ...(args.text ? { Text: { Data: args.text, Charset: "UTF-8" } } : {}),
        },
      },
    },
  };
  if (args.replyTo) body.ReplyToAddresses = [args.replyTo];
  if (args.tags?.length) {
    body.EmailTags = args.tags.map((tag) => ({ Name: tag.name, Value: tag.value }));
  }
  return JSON.stringify(body);
}

function remetenteSes(from: string): string {
  const match = /^(.*) <([^<>]+)>$/.exec(from);
  if (!match || /^[\x20-\x7E]*$/.test(match[1]!)) return from;
  const nome = Buffer.from(match[1]!, "utf8").toString("base64");
  return `=?UTF-8?B?${nome}?= <${match[2]}>`;
}

function assinatura(payload: string, agora: Date) {
  const region = env.AWS_SES_REGION.trim();
  const host = `email.${region}.amazonaws.com`;
  const amzDate = agora.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256(payload);
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalHeaders =
    `content-type:${CONTENT_TYPE}\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const canonicalRequest = [
    "POST",
    "/v2/email/outbound-emails",
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const scope = `${dateStamp}/${region}/${SERVICE}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
  const dateKey = hmac(`AWS4${env.AWS_SES_SECRET_ACCESS_KEY}`, dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, SERVICE);
  const signingKey = hmac(serviceKey, "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");

  return {
    host,
    headers: {
      "content-type": CONTENT_TYPE,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      authorization:
        `AWS4-HMAC-SHA256 Credential=${env.AWS_SES_ACCESS_KEY_ID}/${scope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

function respostaAws(texto: string): { message?: string; type?: string; messageId?: string } {
  try {
    const value = JSON.parse(texto) as Record<string, unknown>;
    return {
      message: typeof value.message === "string" ? value.message : undefined,
      type:
        typeof value.__type === "string"
          ? value.__type
          : typeof value.name === "string"
            ? value.name
            : undefined,
      messageId: typeof value.MessageId === "string" ? value.MessageId : undefined,
    };
  } catch {
    return { message: texto || undefined };
  }
}

export const sesAdapter: EmailAdapter = {
  isConfigured() {
    return Boolean(
      env.AWS_SES_REGION.trim() &&
      env.AWS_SES_ACCESS_KEY_ID.trim() &&
      env.AWS_SES_SECRET_ACCESS_KEY.trim(),
    );
  },

  async send(args, from) {
    if (!this.isConfigured()) return { ok: false, error: "not_configured" };

    try {
      const payload = corpo(args, from);
      const { host, headers } = assinatura(payload, new Date());
      // Fetch + crypto nativos evitam o peso transitivo do SDK AWS no bundle;
      // a pequena superfície SigV4 fica isolada neste adaptador e coberta por teste.
      const response = await fetch(`https://${host}/v2/email/outbound-emails`, {
        method: "POST",
        headers,
        body: payload,
      });
      const parsed = respostaAws(await response.text());

      if (!response.ok) {
        const nome = parsed.type ?? `HTTP ${response.status}`;
        const message = parsed.message ?? response.statusText;
        return {
          ok: false,
          error: classificarErroEmail(nome, `${response.status} ${message}`),
          details: message || nome,
        };
      }

      return { ok: true, id: parsed.messageId };
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
