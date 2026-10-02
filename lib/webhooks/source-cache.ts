import type { SupabaseClient } from "@supabase/supabase-js";

import {
  substituirCacheCompletoDeFontes,
  type WebhookSourceSnapshot,
} from "@/lib/webhooks/lead-reserve";
import { decryptWebhookSecret } from "@/lib/webhooks/secrets";

const SOURCE_SELECT =
  "id, name, organization_id, path_token, secret_encrypted, default_pipeline_id, default_stage_id, default_owner_user_id, field_map, redirect_to, is_active, merge_repeated_submissions";

type SourceRow = Omit<WebhookSourceSnapshot, "source_secret"> & { path_token: string };

/**
 * Espelha as fontes no Redis enquanto o banco está saudável.
 *
 * O service role nunca faz uma leitura tenant-aware sem filtro: primeiro lista
 * as organizações e depois busca cada fonte com `organization_id` explícito.
 * O marcador de cache completo só é escrito depois que TODAS terminam; assim,
 * ausência no cache vira 404 apenas quando sabemos que não é uma fotografia
 * parcial.
 */
export async function sincronizarCacheDeFontesWebhook(
  admin: SupabaseClient,
): Promise<{ organizations: number; sources: number }> {
  const { data: organizations, error: organizationsError } = await admin
    .from("organizations")
    .select("id")
    .order("id", { ascending: true });
  if (organizationsError) throw organizationsError;

  const fontes: Array<{ token: string; source: WebhookSourceSnapshot }> = [];
  for (const organization of organizations ?? []) {
    const organizationId = String(organization.id);
    const { data, error } = await admin
      .from("webhook_sources")
      .select(SOURCE_SELECT)
      .eq("organization_id", organizationId)
      .order("id", { ascending: true });
    if (error) throw error;

    for (const row of (data ?? []) as unknown as SourceRow[]) {
      const sourceSecret = row.secret_encrypted
        ? await decryptWebhookSecret(admin, row.secret_encrypted)
        : null;
      const { path_token: token, ...source } = row;
      fontes.push({ token, source: { ...source, source_secret: sourceSecret } });
    }
  }

  await substituirCacheCompletoDeFontes(fontes);
  return { organizations: organizations?.length ?? 0, sources: fontes.length };
}
