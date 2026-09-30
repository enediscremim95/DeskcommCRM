import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { fail, ok } from "@/lib/api/wrappers";
import { WHATSAPP_EXTENSION_ID } from "@/lib/browser-extension/constants";
import {
  comCorsDaExtensao,
  origemDaExtensaoPermitida,
  respostaPreflightDaExtensao,
} from "@/lib/browser-extension/cors";
import { hashExtensionSecret, novoTokenDaExtensao } from "@/lib/browser-extension/security";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSupportWrite } from "@/lib/impersonate/support";

const schema = z.object({ pairing_code: z.string().min(12).max(64), crm_origin: z.string().url() });
export const dynamic = "force-dynamic";
export const OPTIONS = respostaPreflightDaExtensao;

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return comCorsDaExtensao(supportDenied);
  if (
    !origemDaExtensaoPermitida(req) ||
    req.headers.get("x-extension-id") !== WHATSAPP_EXTENSION_ID
  ) {
    return comCorsDaExtensao(fail("forbidden", "Extensão não autorizada.", 403, { requestId }));
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (
    !parsed.success ||
    req.headers.get("x-crm-origin") !== parsed.data?.crm_origin ||
    req.nextUrl.origin !== parsed.data?.crm_origin
  ) {
    return comCorsDaExtensao(fail("validation_failed", "Pareamento inválido.", 422, { requestId }));
  }
  const rate = await checkRateLimit(
    `browser-extension-pair:${hashExtensionSecret(req.headers.get("x-forwarded-for") ?? "local")}`,
    20,
    60,
  );
  if (!rate.allowed) {
    return comCorsDaExtensao(
      fail("rate_limited", "Tente novamente em instantes.", 429, { requestId }),
    );
  }
  const admin = createAdminClient();
  const codeHash = hashExtensionSecret(parsed.data.pairing_code);
  const { data: pairing } = await admin
    .from("browser_extension_pairings")
    .select("id")
    .eq("pairing_code_hash", codeHash)
    .eq("crm_origin", parsed.data.crm_origin)
    .eq("extension_id", WHATSAPP_EXTENSION_ID)
    .is("access_token_hash", null)
    .is("revoked_at", null)
    .gt("pairing_code_expires_at", new Date().toISOString())
    .maybeSingle();
  if (!pairing)
    return comCorsDaExtensao(fail("not_found", "Pareamento expirado.", 404, { requestId }));
  const token = novoTokenDaExtensao();
  const { data: redeemed, error } = await admin
    .from("browser_extension_pairings")
    .update({
      access_token_hash: hashExtensionSecret(token),
      paired_at: new Date().toISOString(),
      pairing_code_expires_at: new Date().toISOString(),
    })
    .eq("id", pairing.id)
    .eq("pairing_code_hash", codeHash)
    .is("access_token_hash", null)
    .select("id")
    .maybeSingle();
  if (error || !redeemed)
    return comCorsDaExtensao(fail("not_found", "Pareamento expirado.", 404, { requestId }));
  return comCorsDaExtensao(ok({ access_token: token, pairing_id: pairing.id }, { requestId }));
}
