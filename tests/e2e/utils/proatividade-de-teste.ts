import { createClient } from "@supabase/supabase-js";
import { credenciaisSupabaseDeTeste } from "../../../scripts/lib/env-de-teste";

/** Opt-in explícito e reversível para fixtures de silêncio, só em Supabase local. */
export async function habilitarProatividadeNoTeste(orgId: string): Promise<() => Promise<void>> {
  const credentials = credenciaisSupabaseDeTeste();
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(credentials.url).hostname)) {
    throw new Error("Opt-in de fixture exige Supabase local de teste");
  }
  const db = createClient(credentials.url, credentials.serviceRole, { auth: { persistSession: false } });
  const ler = async () => {
    const { data, error } = await db.from("organizations").select("settings").eq("id", orgId).single();
    if (error) throw error;
    return (data.settings ?? {}) as Record<string, unknown>;
  };
  const salvar = async (settings: Record<string, unknown>) => {
    const { error } = await db.from("organizations").update({ settings }).eq("id", orgId);
    if (error) throw error;
  };
  const before = await ler();
  await salvar({ ...before, proactive_followup: {
    enabled: true, start_hour: 0, end_hour: 24,
    weekdays: [0, 1, 2, 3, 4, 5, 6], timezone: "UTC",
  } });
  return async () => {
    const settings = await ler();
    if (Object.prototype.hasOwnProperty.call(before, "proactive_followup")) {
      settings.proactive_followup = before.proactive_followup;
    } else delete settings.proactive_followup;
    await salvar(settings);
  };
}
