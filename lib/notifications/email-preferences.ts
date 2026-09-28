import type { SupabaseClient } from "@supabase/supabase-js";

export interface EmailNotificationPreferences {
  email_enabled: boolean;
  new_lead: boolean;
  urgent_lead: boolean;
}

/**
 * O aviso de LEAD NOVO nasce desligado; o de ação urgente, ligado.
 *
 * Medido numa operação real em 25/09/2026: 28 leads num dia, três pessoas na
 * organização, 84 e-mails — num plano de 100 por dia que é o MESMO que envia
 * convite e recuperação de senha. A enxurrada quase derrubou o que importa.
 *
 * O urgente continua ligado porque já sai agrupado, com teto diário, e só
 * dispara quando há o que fazer.
 */
export const DEFAULT_EMAIL_NOTIFICATION_PREFERENCES: EmailNotificationPreferences = {
  email_enabled: true,
  new_lead: false,
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
  // `?? padrão` e não `!== false`: com o padrão de lead novo desligado, tratar
  // qualquer valor ausente como ligado desfaria a mudança em silêncio.
  const row = data as unknown as Partial<EmailNotificationPreferences>;
  return {
    email_enabled: row.email_enabled ?? DEFAULT_EMAIL_NOTIFICATION_PREFERENCES.email_enabled,
    new_lead: row.new_lead ?? DEFAULT_EMAIL_NOTIFICATION_PREFERENCES.new_lead,
    urgent_lead: row.urgent_lead ?? DEFAULT_EMAIL_NOTIFICATION_PREFERENCES.urgent_lead,
  };
}
