import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  applyEmailNotificationPreferencesPatch,
  readEmailNotificationPreferences,
} from "./email-preferences";

function dbCom(responses: Record<string, Array<{ data: unknown; error: null }>>) {
  return {
    from: vi.fn((table: string) => {
      const response = responses[table]!.shift()!;
      const builder = {
        select: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        is: vi.fn(() => builder),
        maybeSingle: vi.fn(async () => response),
      };
      return builder;
    }),
  } as unknown as SupabaseClient;
}

describe("readEmailNotificationPreferences", () => {
  it("sem preferência gravada, lead novo nasce desligado e urgente ligado", async () => {
    // Mudou de propósito em 25/09/2026: com lead novo ligado por padrão, uma
    // operação com 28 leads e três pessoas gerou 84 e-mails num plano de 100
    // por dia, o mesmo do convite e da recuperação de senha.
    const db = dbCom({
      notification_email_preferences: [{ data: null, error: null }],
      platform_admins: [{ data: null, error: null }],
    });

    await expect(readEmailNotificationPreferences(db, "org-1", "user-1")).resolves.toEqual({
      email_enabled: true,
      new_lead: false,
      urgent_lead: true,
    });
  });

  it("mostra padrão desligado ao administrador da plataforma até ele marcar a organização", async () => {
    const db = dbCom({
      notification_email_preferences: [{ data: null, error: null }],
      platform_admins: [{ data: { user_id: "platform-1" }, error: null }],
    });

    await expect(readEmailNotificationPreferences(db, "org-1", "platform-1")).resolves.toEqual({
      email_enabled: false,
      new_lead: false,
      urgent_lead: false,
    });
  });

  it("desliga e religa o mestre sem alterar as escolhas por categoria", () => {
    const escolhas = { email_enabled: true, new_lead: false, urgent_lead: true };
    const desligadas = applyEmailNotificationPreferencesPatch(escolhas, { email_enabled: false });
    const religadas = applyEmailNotificationPreferencesPatch(desligadas, { email_enabled: true });

    expect(religadas).toEqual(escolhas);
  });
});
