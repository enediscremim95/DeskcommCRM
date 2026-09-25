import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { traduzir } from "@/lib/i18n/dicionario";
import {
  parseEmailNotificationPolicy,
  readEmailNotificationPolicy,
} from "@/lib/notifications/email-policy";
import { readEmailNotificationPreferences } from "@/lib/notifications/email-preferences";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    new_lead: z.boolean().optional(),
    urgent_lead: z.boolean().optional(),
    urgent_batch_window_minutes: z.number().int().min(5).max(1_440).optional(),
    urgent_daily_limit: z.number().int().min(1).max(24).optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "Informe ao menos uma preferência.",
  });

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", {
    requestId,
    resource: "notification_email_preferences",
  });
  if (!authz.ok) return authz.response;
  try {
    const preferences = await readEmailNotificationPreferences(
      await createClient(),
      authz.org.orgId,
      authz.user.id,
    );
    const policy = await readEmailNotificationPolicy(await createClient(), authz.org.orgId);
    return ok({ preferences, policy }, { requestId });
  } catch {
    return fail(
      "internal_error",
      traduzir("Falha ao carregar preferências.", authz.user.idioma),
      500,
      { requestId },
    );
  }
}

export async function PUT(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("viewer", {
    requestId,
    resource: "notification_email_preferences",
  });
  if (!authz.ok) return authz.response;
  const t = (text: string) => traduzir(text, authz.user.idioma);

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("invalid_request", t("Body JSON inválido."), 400, { requestId });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return fail("validation_failed", t("Campos inválidos."), 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const db = await createClient();
  const personalPatch = {
    ...(parsed.data.new_lead === undefined ? {} : { new_lead: parsed.data.new_lead }),
    ...(parsed.data.urgent_lead === undefined ? {} : { urgent_lead: parsed.data.urgent_lead }),
  };
  const policyPatch = {
    ...(parsed.data.urgent_batch_window_minutes === undefined
      ? {}
      : { urgent_batch_window_minutes: parsed.data.urgent_batch_window_minutes }),
    ...(parsed.data.urgent_daily_limit === undefined
      ? {}
      : { urgent_daily_limit: parsed.data.urgent_daily_limit }),
  };
  if (Object.keys(policyPatch).length > 0) {
    const manager = await requireRole("manager", {
      requestId,
      resource: "notification_email_policy",
      organizationId: authz.org.orgId,
    });
    if (!manager.ok) return manager.response;
  }

  const current = await readEmailNotificationPreferences(db, authz.org.orgId, authz.user.id);
  const next = { ...current, ...personalPatch };
  if (Object.keys(personalPatch).length > 0) {
    const { error } = await db.from("notification_email_preferences" as never).upsert(
      {
        organization_id: authz.org.orgId,
        user_id: authz.user.id,
        new_lead: next.new_lead,
        urgent_lead: next.urgent_lead,
        updated_at: new Date().toISOString(),
      } as never,
      { onConflict: "organization_id,user_id" },
    );
    if (error) {
      return fail("internal_error", t("Falha ao salvar preferências."), 500, { requestId });
    }
  }

  let policy = await readEmailNotificationPolicy(db, authz.org.orgId);
  if (Object.keys(policyPatch).length > 0) {
    // `organizations` só aceita esta escrita pelo service role. O tenant vem
    // da sessão e continua explícito porque o client admin bypassa RLS.
    const admin = createAdminClient();
    const { data: organization, error: organizationError } = await admin
      .from("organizations")
      .select("settings")
      .eq("id", authz.org.orgId)
      .maybeSingle();
    if (organizationError) {
      return fail("internal_error", t("Falha ao salvar preferências."), 500, { requestId });
    }
    const settings =
      organization?.settings && typeof organization.settings === "object"
        ? (organization.settings as Record<string, unknown>)
        : {};
    const notifications =
      settings.notifications && typeof settings.notifications === "object"
        ? (settings.notifications as Record<string, unknown>)
        : {};
    const email =
      notifications.email && typeof notifications.email === "object"
        ? (notifications.email as Record<string, unknown>)
        : {};
    const updatedSettings = {
      ...settings,
      notifications: {
        ...notifications,
        email: { ...email, ...policyPatch },
      },
    };
    const { error } = await admin
      .from("organizations")
      .update({ settings: updatedSettings })
      .eq("id", authz.org.orgId);
    if (error) {
      return fail("internal_error", t("Falha ao salvar preferências."), 500, { requestId });
    }
    policy = parseEmailNotificationPolicy(updatedSettings);
  }

  await audit({
    action: "notification_prefs.changed",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "notification_email_preferences",
    requestId,
    metadata: { channel: "email", changed: Object.keys(parsed.data) },
  });
  return ok({ preferences: next, policy }, { requestId });
}
