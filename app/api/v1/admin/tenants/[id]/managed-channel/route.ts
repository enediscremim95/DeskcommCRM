import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { findManagedConnector, managedConnectorAdminErrorMessage, ManagedConnectorError, saveManagedConnector } from "@/lib/channels/managed-qr";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
const idSchema = z.string().uuid();
const inputSchema = z.object({
  base_url: z.string().url().max(500),
  instance_name: z.string().trim().min(1).max(120).regex(/^[\p{L}\p{N}._-]+$/u),
  phone_number: z.string().trim().regex(/^\+?\d{8,15}$/),
  display_name: z.string().trim().max(120).nullable().optional(),
  api_key: z.string().trim().min(8).max(500).nullable().optional(),
  reconnect_hook_url: z.string().url().max(1000).nullable().optional(),
});

async function platformAdmin() {
  try { return await requirePlatformAdmin(); } catch { return null; }
}

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();
  if (!(await platformAdmin())) return fail("forbidden", "Platform admin required", 403, { requestId });
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) return fail("validation_failed", "Organização inválida.", 422, { requestId });
  try { return ok(await findManagedConnector(createAdminClient(), id), { requestId }); }
  catch { return fail("internal_error", "Não foi possível carregar o conector.", 500, { requestId }); }
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const adminContext = await platformAdmin();
  if (!adminContext) return fail("forbidden", "Platform admin required", 403, { requestId });
  const { id } = await context.params;
  const parsedId = idSchema.safeParse(id);
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsedId.success || !parsed.success) return fail("validation_failed", "Configuração inválida.", 422, {
    requestId, details: parsed.success ? undefined : parsed.error.flatten(),
  });
  try {
    const connector = await saveManagedConnector(createAdminClient(), {
      organizationId: id, baseUrl: parsed.data.base_url, instanceName: parsed.data.instance_name,
      phoneNumber: parsed.data.phone_number, displayName: parsed.data.display_name,
      apiKey: parsed.data.api_key, reconnectHookUrl: parsed.data.reconnect_hook_url,
    });
    await audit({
      action: "channel.managed_configured", actorUserId: adminContext.user.id, organizationId: id,
      resourceType: "channel_session", resourceId: connector.id, requestId,
      bypassedRls: true, actingAsPlatformAdmin: true,
      metadata: { instance_name: connector.instance_name, hook_configured: Boolean(connector.reconnect_hook_url), key_replaced: Boolean(parsed.data.api_key) },
    });
    return ok(connector, { requestId });
  } catch (error) {
    if (error instanceof ManagedConnectorError) {
      return fail(error.code, managedConnectorAdminErrorMessage(error.code), error.status, { requestId });
    }
    return fail("internal_error", "Não foi possível salvar o conector.", 500, { requestId });
  }
}
