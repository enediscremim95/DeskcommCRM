import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  serializeTrafficColumnPresets,
  trafficColumnPresetColumnsSchema,
  trafficColumnPresetNameSchema,
} from "@/lib/windsor/column-presets";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: trafficColumnPresetNameSchema,
  columns: trafficColumnPresetColumnsSchema,
});

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "reports" });
  if (!authz.ok) return authz.response;

  const organizationId = authz.org.orgId;
  const admin = createAdminClient();
  const [{ data: config, error: configError }, { data: presets, error: presetsError }] =
    await Promise.all([
      admin
        .from("traffic_dashboard_configs" as never)
        .select("default_column_preset_id")
        .eq("organization_id", organizationId)
        .eq("enabled", true)
        .maybeSingle(),
      admin
        .from("traffic_dashboard_column_presets" as never)
        .select("id,name,metric_columns")
        .eq("organization_id", organizationId)
        .order("name"),
    ]);

  if (configError || presetsError) {
    return fail("internal_error", "Não foi possível ler as predefinições.", 500, {
      requestId,
    });
  }
  const defaultPresetId =
    (config as unknown as { default_column_preset_id: string | null } | null)
      ?.default_column_preset_id ?? null;
  return ok(
    {
      presets: serializeTrafficColumnPresets(
        presets as unknown as Array<{ id: string; name: string; metric_columns: unknown }>,
        defaultPresetId,
      ),
      default_preset_id: defaultPresetId,
    },
    { requestId },
  );
}

export async function POST(request: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "reports" });
  if (!authz.ok) return authz.response;
  if (!authz.user.is_platform_admin || authz.user.support) {
    return fail("forbidden", "Apenas o admin da plataforma pode criar predefinições.", 403, {
      requestId,
    });
  }
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_error", "Predefinição inválida.", 400, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const organizationId = authz.org.orgId;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("traffic_dashboard_column_presets" as never)
    .insert({
      organization_id: organizationId,
      name: parsed.data.name,
      metric_columns: parsed.data.columns,
      created_by: authz.user.id,
      updated_by: authz.user.id,
    } as never)
    .select("id,name,metric_columns")
    .single();
  if (error?.code === "23505") {
    return fail("conflict", "Já existe uma predefinição com este nome.", 409, { requestId });
  }
  if (error || !data) {
    return fail("internal_error", "Não foi possível criar a predefinição.", 500, {
      requestId,
    });
  }
  const row = data as unknown as { id: string; name: string; metric_columns: unknown };
  const preset = serializeTrafficColumnPresets([row], null)[0];
  if (!preset) {
    return fail("internal_error", "A predefinição salva ficou inválida.", 500, { requestId });
  }
  await audit({
    action: "traffic_dashboard.column_preset_created",
    actorUserId: authz.user.id,
    organizationId,
    resourceType: "traffic_dashboard_column_preset",
    resourceId: preset.id,
    requestId,
    bypassedRls: true,
    actingAsPlatformAdmin: true,
    metadata: { name: preset.name, columns: preset.columns },
  });
  return ok({ preset }, { requestId, status: 201 });
}
