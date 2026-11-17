import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalPhoneBR, phoneLookupVariants } from "@/lib/channels/phone-variants";
export interface CaptureClaim { eventId: string; phone: string }
export function protectedCapturePhone(phone: string): boolean {
  return /(997153441|97153441)$/.test(phone.replace(/\D/g, ""));
}
export async function claimCapture(db: SupabaseClient, org: string, contact: string, claim: CaptureClaim): Promise<boolean> {
  if (protectedCapturePhone(claim.phone)) return false;
  const { data, error } = await db.rpc("fn_capture_contact_claim", {
    p_org: org, p_event: claim.eventId, p_contact: contact,
    p_phone: canonicalPhoneBR(claim.phone), p_variants: phoneLookupVariants(claim.phone),
  });
  if (error) throw new Error("capture_claim_failed");
  return data === true;
}
