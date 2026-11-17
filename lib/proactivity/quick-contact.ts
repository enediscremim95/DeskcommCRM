import { createAdminClient } from "@/lib/supabase/admin";
import { canonicalPhoneBR, phoneLookupVariants } from "@/lib/channels/phone-variants";
import { ApiError } from "@/lib/api/types";

export function quickPhone(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  const phone = canonicalPhoneBR(digits);
  if (!/^\+\d{8,15}$/.test(phone)) throw new ApiError(422, "validation_failed", undefined, "quick-contact");
  return phone;
}
export async function quickContact(org: string, raw: string, requestId: string): Promise<string> {
  const db = createAdminClient();
  const phone = quickPhone(raw);
  const find = () => db.from("contacts").select("id").eq("organization_id", org)
    .in("phone_number", phoneLookupVariants(phone)).is("is_merged_into", null).order("created_at").limit(1).maybeSingle();
  const previous = await find();
  if (previous.error) throw new ApiError(500, "internal_error", undefined, requestId);
  if (previous.data) return previous.data.id;
  const inserted = await db.from("contacts").insert({ organization_id: org, phone_number: phone, source: "manual" }).select("id").single();
  if (inserted.data) return inserted.data.id;
  if (inserted.error?.code === "23505") {
    const winner = await find();
    if (!winner.error && winner.data) return winner.data.id;
  }
  throw new ApiError(500, "internal_error", undefined, requestId);
}
export async function existingQuickLead(org: string, key: string, contact?: string, pipeline?: string): Promise<Record<string, unknown> | null> {
  const result = await createAdminClient().from("crm_leads").select("*").eq("organization_id", org).eq("source", "manual").eq("external_id", key).maybeSingle();
  if (result.error) throw new ApiError(500, "internal_error", undefined, "quick-contact");
  if (result.data || !contact || !pipeline) return result.data;
  const existing = await createAdminClient().from("crm_leads").select("*").eq("organization_id", org)
    .eq("contact_id", contact).eq("pipeline_id", pipeline).eq("status", "open")
    .order("created_at").limit(1).maybeSingle();
  if (existing.error) throw new ApiError(500, "internal_error", undefined, "quick-contact");
  return existing.data;
}
