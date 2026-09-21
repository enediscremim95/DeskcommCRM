import type { SupabaseClient } from "@supabase/supabase-js";

export interface EmailNotificationPreferences {
  new_lead: boolean;
  urgent_lead: boolean;
}

export const DEFAULT_EMAIL_NOTIFICATION_PREFERENCES: EmailNotificationPreferences = {
  new_lead: true,
  urgent_lead: true,
};

export async function readEmailNotificationPreferences(
  db: SupabaseClient,
  organizationId: string,
  userId: string,
): Promise<EmailNotificationPreferences> {
  const { data, error } = await db
    .from("notification_email_preferences" as never)
    .select("new_lead,urgent_lead" as never)
    .eq("organization_id" as never, organizationId)
    .eq("user_id" as never, userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return { ...DEFAULT_EMAIL_NOTIFICATION_PREFERENCES };
  const row = data as unknown as Partial<EmailNotificationPreferences>;
  return {
    new_lead: row.new_lead !== false,
    urgent_lead: row.urgent_lead !== false,
  };
}
