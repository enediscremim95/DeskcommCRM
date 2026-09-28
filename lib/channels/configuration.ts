import type { SupabaseClient } from "@supabase/supabase-js";

export async function updateChannelAiConcurrency(
  db: SupabaseClient,
  organizationId: string,
  channelSessionId: string,
  maxConcurrent: number,
): Promise<{ found: boolean; error: string | null }> {
  const { data, error } = await db
    .from("channel_sessions")
    .update({ max_concurrent_ai_conversations: maxConcurrent } as never)
    .eq("id", channelSessionId)
    .eq("organization_id", organizationId)
    .is("archived_at", null)
    .select("id")
    .maybeSingle();

  return { found: data !== null, error: error?.message ?? null };
}
