import type { SupabaseClient } from "@supabase/supabase-js";
import { idsDoContatoEGemeos } from "@/lib/channels/contato-por-telefone";
/** A primeira conversa alimenta a captação aberta, mesmo fora da janela de reenvio.
 * Não funde demandas distintas nem muda etapa/status. Ambiguidade exige revisão humana. */
export async function formularioAbertoDoContato(db: SupabaseClient, organizationId: string, contactId: string): Promise<string | null> {
 const ids = await idsDoContatoEGemeos(db, organizationId, contactId);
 const { data, error } = await db.from("crm_leads").select("id")
  .eq("organization_id", organizationId).in("contact_id", ids).eq("source", "webhook").eq("status", "open").limit(2);
 if (error) throw new Error("form_lead_lookup_failed");
 if ((data?.length ?? 0) > 1) throw new Error("ambiguous_form_leads");
 return data?.[0]?.id ?? null;
}
