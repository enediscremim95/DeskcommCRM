import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptWebhookSecret } from "@/lib/webhooks/secrets";
import { contaDaAgendaPrimaria } from "./calendarios";
import { classificarErroDoGoogle, estadoDaConexaoApos } from "./erros";
import { recordGoogleConnectionFailure } from "./fallback";

/** Leitura autenticada no Google: o status salvo sozinho não prova saúde. */
export async function verifiedGoogleStatus(
  db: SupabaseClient,
  organizationId: string,
  connectionId: string,
): Promise<string> {
  try {
    const { data, error } = await db
      .from("calendar_connections")
      .select("status,oauth_access_token_encrypted")
      .eq("organization_id", organizationId)
      .eq("id", connectionId)
      .maybeSingle();
    if (error || !data) return "error";
    if (data.status !== "healthy") return data.status;
    const token = await decryptWebhookSecret(db, data.oauth_access_token_encrypted);
    if (!token) return "error";
    const result = await contaDaAgendaPrimaria(token);
    if (result.ok) return "healthy";
    await recordGoogleConnectionFailure(db, {
      organizationId,
      connectionId,
      error: result.erro,
      operation: "listar",
    });
    return estadoDaConexaoApos(classificarErroDoGoogle(result.erro, "listar").desfecho) ?? "error";
  } catch {
    // Falha da integração não derruba a Agenda e nunca vira saúde presumida.
    return "error";
  }
}
