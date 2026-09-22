import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  columnsBelongToPlatform,
  serializeTrafficColumnPresets,
  trafficColumnPresetColumnsSchema,
  trafficColumnPresetNameSchema,
  trafficColumnPresetPlatformSchema,
} from "@/lib/windsor/column-presets";

export const dynamic = "force-dynamic";

const idSchema = z.string().uuid();
const updateSchema = z
  .union([
    z
      .object({ platform: trafficColumnPresetPlatformSchema, name: trafficColumnPresetNameSchema })
      .strict(),
    z
      .object({
        platform: trafficColumnPresetPlatformSchema,
        columns: trafficColumnPresetColumnsSchema,
      })
      .strict(),
    z
      .object({ platform: trafficColumnPresetPlatformSchema, make_default: z.literal(true) })
      .strict(),
  ])
  .superRefine((value, context) => {
    if ("columns" in value && !columnsBelongToPlatform(value.platform, value.columns)) {
      context.addIssue({
        code: "custom",
        path: ["columns"],
        message: "Há colunas incompatíveis com a plataforma.",
      });
    }
  });

type Context = { params: Promise<{ id: string }> };

async function platformAdmin(requestId: string) {
  const authz = await requireRole("viewer", { requestId, resource: "reports" });
  if (!authz.ok) return authz;
  if (!authz.user.is_platform_admin || authz.user.support) {
    return {
      ok: false as const,
      response: fail("forbidden", "Apenas o admin da plataforma pode alterar predefinições.", 403, {
        requestId,
      }),
    };
  }
  return authz;
}

export async function PATCH(request: NextRequest, context: Context): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await platformAdmin(requestId);
  if (!authz.ok) return authz.response;
  const { id } = await context.params;
  const parsedId = idSchema.safeParse(id);
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsedId.success || !parsed.success) {
    return fail("validation_error", "Alteração inválida.", 400, {
      requestId,
      details: parsed.success ? undefined : parsed.error.flatten(),
    });
  }

  const organizationId = authz.org.orgId;
  const admin = createAdminClient();
  const { data: current, error: currentError } = await admin
    .from("traffic_dashboard_column_presets" as never)
    .select("id,name,metric_columns,platform")
    .eq("id", parsedId.data)
    .eq("organization_id", organizationId)
    .eq("platform", parsed.data.platform)
    .maybeSingle();
  if (currentError) {
    return fail("internal_error", "Não foi possível ler a predefinição.", 500, { requestId });
  }
  if (!current) return fail("not_found", "Predefinição não encontrada.", 404, { requestId });

  let row = current as unknown as {
    id: string;
    name: string;
    metric_columns: unknown;
    platform: unknown;
  };
  let action:
    "traffic_dashboard.column_preset_updated" | "traffic_dashboard.column_preset_defaulted" =
    "traffic_dashboard.column_preset_updated";
  if ("make_default" in parsed.data) {
    const defaultColumn =
      parsed.data.platform === "meta_ads"
        ? "default_meta_column_preset_id"
        : "default_google_column_preset_id";
    const { data: config, error } = await admin
      .from("traffic_dashboard_configs" as never)
      .update({ [defaultColumn]: parsedId.data, updated_by: authz.user.id } as never)
      .eq("organization_id", organizationId)
      .eq("enabled", true)
      .select("organization_id")
      .maybeSingle();
    if (error || !config) {
      return fail("internal_error", "Não foi possível marcar a predefinição como padrão.", 500, {
        requestId,
      });
    }
    action = "traffic_dashboard.column_preset_defaulted";
  } else {
    const changes =
      "name" in parsed.data
        ? { name: parsed.data.name, updated_by: authz.user.id }
        : { metric_columns: parsed.data.columns, updated_by: authz.user.id };
    const { data, error } = await admin
      .from("traffic_dashboard_column_presets" as never)
      .update(changes as never)
      .eq("id", parsedId.data)
      .eq("organization_id", organizationId)
      .eq("platform", parsed.data.platform)
      .select("id,name,metric_columns,platform")
      .maybeSingle();
    if (error?.code === "23505") {
      return fail("conflict", "Já existe uma predefinição com este nome.", 409, { requestId });
    }
    if (error || !data) {
      return fail("internal_error", "Não foi possível atualizar a predefinição.", 500, {
        requestId,
      });
    }
    row = data as unknown as {
      id: string;
      name: string;
      metric_columns: unknown;
      platform: unknown;
    };
  }

  const preset = serializeTrafficColumnPresets(
    [row],
    action === "traffic_dashboard.column_preset_defaulted" ? parsedId.data : null,
  )[0];
  if (!preset) {
    return fail("internal_error", "A predefinição salva ficou inválida.", 500, { requestId });
  }
  await audit({
    action,
    actorUserId: authz.user.id,
    organizationId,
    resourceType: "traffic_dashboard_column_preset",
    resourceId: preset.id,
    requestId,
    bypassedRls: true,
    actingAsPlatformAdmin: true,
    metadata:
      "make_default" in parsed.data
        ? { name: preset.name, platform: preset.platform }
        : parsed.data,
  });
  return ok({ preset }, { requestId });
}

export async function DELETE(request: NextRequest, context: Context): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await platformAdmin(requestId);
  if (!authz.ok) return authz.response;
  const { id } = await context.params;
  const parsedId = idSchema.safeParse(id);
  const platform = trafficColumnPresetPlatformSchema.safeParse(
    new URL(request.url).searchParams.get("platform"),
  );
  if (!parsedId.success || !platform.success) {
    return fail("validation_error", "Predefinição inválida.", 400, { requestId });
  }
  const organizationId = authz.org.orgId;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("traffic_dashboard_column_presets" as never)
    .delete()
    .eq("id", parsedId.data)
    .eq("organization_id", organizationId)
    .eq("platform", platform.data)
    .select("id,name,platform")
    .maybeSingle();
  if (error) {
    return fail("internal_error", "Não foi possível excluir a predefinição.", 500, { requestId });
  }
  if (!data) return fail("not_found", "Predefinição não encontrada.", 404, { requestId });
  const deleted = data as unknown as { id: string; name: string; platform: string };
  await audit({
    action: "traffic_dashboard.column_preset_deleted",
    actorUserId: authz.user.id,
    organizationId,
    resourceType: "traffic_dashboard_column_preset",
    resourceId: deleted.id,
    requestId,
    bypassedRls: true,
    actingAsPlatformAdmin: true,
    metadata: { name: deleted.name, platform: deleted.platform },
  });
  return ok({ deleted: true }, { requestId });
}
