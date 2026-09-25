import type { SupabaseClient } from "@supabase/supabase-js";

export interface EmailNotificationPreferences {
  email_enabled: boolean;
  new_lead: boolean;
  urgent_lead: boolean;
}

export const DEFAULT_EMAIL_NOTIFICATION_PREFERENCES: EmailNotificationPreferences = {
  email_enabled: true,
  new_lead: true,
  urgent_lead: true,
};

export function applyEmailNotificationPreferencesPatch(
  current: EmailNotificationPreferences,
  patch: Partial<EmailNotificationPreferences>,
): EmailNotificationPreferences {
  return { ...current, ...patch };
}

export async function readEmailNotificationPreferences(
  db: SupabaseClient,
  organizationId: string,
  userId: string,
): Promise<EmailNotificationPreferences> {
  const { data, error } = await db
    .from("notification_email_preferences" as never)
    .select("email_enabled,new_lead,urgent_lead" as never)
    .eq("organization_id" as never, organizationId)
    .eq("user_id" as never, userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    const { data: platformAdmin, error: platformError } = await db
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", userId)
      .is("revoked_at", null)
      .maybeSingle();
    if (platformError) throw platformError;
    if (platformAdmin) return { email_enabled: false, new_lead: false, urgent_lead: false };
    return { ...DEFAULT_EMAIL_NOTIFICATION_PREFERENCES };
  }
  const row = data as unknown as Partial<EmailNotificationPreferences>;
  return {
    email_enabled: row.email_enabled !== false,
    new_lead: row.new_lead !== false,
    urgent_lead: row.urgent_lead !== false,
  };
}
