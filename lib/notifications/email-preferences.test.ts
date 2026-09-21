import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { readEmailNotificationPreferences } from "./email-preferences";

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
  it("mantém padrão ligado para membro comum sem preferência gravada", async () => {
    const db = dbCom({
      notification_email_preferences: [{ data: null, error: null }],
      platform_admins: [{ data: null, error: null }],
    });

    await expect(readEmailNotificationPreferences(db, "org-1", "user-1")).resolves.toEqual({
      new_lead: true,
      urgent_lead: true,
    });
  });

  it("mostra padrão desligado ao administrador da plataforma até ele marcar a organização", async () => {
    const db = dbCom({
      notification_email_preferences: [{ data: null, error: null }],
      platform_admins: [{ data: { user_id: "platform-1" }, error: null }],
    });

    await expect(readEmailNotificationPreferences(db, "org-1", "platform-1")).resolves.toEqual({
      new_lead: false,
      urgent_lead: false,
    });
  });
});
