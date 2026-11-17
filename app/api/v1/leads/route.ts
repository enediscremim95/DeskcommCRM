import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * POST /api/v1/leads — create lead (handler em ./_handler.ts).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ApiError } from "@/lib/api/types";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createLeadSchema, validateRequest, type CreateLeadInput } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/server";

import { createLeadHandler } from "./_handler";
import { quickContact, existingQuickLead } from "@/lib/proactivity/quick-contact";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();

  // spec 13 §4: escrita é agent+ (viewer é read-only).
  const authz = await requireRole("agent", { requestId, resource: "crm_leads" });
  if (!authz.ok) return authz.response;
  const { user: authUser, org: activeOrg } = authz;

  let input;
  try {
    input = await validateRequest(createLeadSchema, req);
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, {
        details: err.details as Record<string, unknown> | undefined,
        requestId,
      });
    }
    throw err;
  }

  const supabase = await createClient();

  try {
    const contact = input.phone_number ? await quickContact(activeOrg.orgId, input.phone_number, requestId) : null;
    const quickKey = contact ? `quick:${input.pipeline_id}:${contact}` : null;
    const existing = quickKey ? await existingQuickLead(activeOrg.orgId, quickKey, contact!, input.pipeline_id) : null;
    if (existing) {
      const existingId = String(existing.id);
      await audit({ action: "lead.quick_reused", actorUserId: authUser.id, organizationId: activeOrg.orgId, resourceType: "crm_lead", resourceId: existingId, requestId });
      return ok(existing, { requestId });
    }
    let lead;
    try {
    lead = await createLeadHandler(
      supabase,
      {
        organization_id: activeOrg.orgId,
        actor: { type: "user", id: authUser.id },
        requestId,
        idioma: authUser.idioma,
      },
      { ...input as CreateLeadInput, ...(contact ? { source: "manual", contact_id: contact, external_id: quickKey! } : {}) },
    );
    } catch (err) {
      // A constraint org/source/external_id arbitra requisições concorrentes.
      const winner = quickKey ? await existingQuickLead(activeOrg.orgId, quickKey, contact!, input.pipeline_id) : null;
      if (!winner) throw err;
      lead = winner;
    }
    return ok(lead, { requestId, status: 201 });
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, { requestId });
    }
    throw err;
  }
}
