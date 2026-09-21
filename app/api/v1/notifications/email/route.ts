import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { traduzir } from "@/lib/i18n/dicionario";
import { readEmailNotificationPreferences } from "@/lib/notifications/email-preferences";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    new_lead: z.boolean().optional(),
    urgent_lead: z.boolean().optional(),
  })
  .refine((value) => value.new_lead !== undefined || value.urgent_lead !== undefined, {
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
    return ok({ preferences }, { requestId });
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
  const current = await readEmailNotificationPreferences(db, authz.org.orgId, authz.user.id);
  const next = { ...current, ...parsed.data };
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
  if (error) return fail("internal_error", t("Falha ao salvar preferências."), 500, { requestId });

  await audit({
    action: "notification_prefs.changed",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "notification_email_preferences",
    requestId,
    metadata: { channel: "email", changed: Object.keys(parsed.data) },
  });
  return ok({ preferences: next }, { requestId });
}
