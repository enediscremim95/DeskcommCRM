import { AuthTemporariamenteIndisponivel } from "@/lib/auth/get-user-com-backoff";
import { comAuthDisponivel } from "@/lib/auth/api-disponivel";
import { randomUUID } from "node:crypto";
import { fail, ok } from "@/lib/api/wrappers";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { fetchWindsorRows30d, WindsorUnavailableError } from "@/lib/windsor/client";
import { discoverAccounts } from "@/lib/windsor/normalizer";

export const dynamic = "force-dynamic";
const FIELDS = [
  "data_source", "account_id", "account_name", "account_currency", "currency",
  "campaign_name", "spend", "cost", "impressions",
] as const;

async function GETComAuth(): Promise<Response> {
  const requestId = randomUUID();
  try { await requirePlatformAdmin(); } catch (erroDeAuth) {
    if (erroDeAuth instanceof AuthTemporariamenteIndisponivel) throw erroDeAuth;
    return fail("forbidden", "Platform admin required", 403, { requestId });
  }
  try {
    return ok({ accounts: discoverAccounts(await fetchWindsorRows30d(FIELDS)) }, { requestId });
  } catch (error) {
    if (error instanceof AuthTemporariamenteIndisponivel) throw error;
    const message = error instanceof WindsorUnavailableError ? error.message : "Não foi possível consultar o Windsor.";
    return fail("upstream_unavailable", message, 503, { requestId });
  }
}

export const GET = comAuthDisponivel(GETComAuth);
