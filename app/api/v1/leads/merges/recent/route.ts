import { randomUUID } from "node:crypto";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import type { JuncaoDeNegociosRecente } from "@/lib/leads/negocios-duplicados";
import { createClient } from "@/lib/supabase/server";

interface LogRow {
  id: string;
  survivor_lead_id: string;
  absorbed_lead_id: string;
  absorbed_snapshot: { title?: unknown };
  merged_by_user_id: string | null;
  merged_at: string;
}

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "crm_lead_merge" });
  if (!authz.ok) return authz.response;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("crm_lead_merge_log" as never)
    .select("id,survivor_lead_id,absorbed_lead_id,absorbed_snapshot,merged_by_user_id,merged_at")
    .eq("organization_id", authz.org.orgId)
    .is("undone_at", null)
    .order("merged_at", { ascending: false })
    .limit(30);
  if (error) return fail("internal_error", error.message, 500, { requestId });

  const logs = (data ?? []) as unknown as LogRow[];
  const ids = [...new Set(logs.map((item) => item.survivor_lead_id))];
  const { data: leads, error: leadsError } = ids.length
    ? await supabase
        .from("crm_leads")
        .select("id,title")
        .eq("organization_id", authz.org.orgId)
        .in("id", ids)
    : { data: [], error: null };
  if (leadsError) return fail("internal_error", leadsError.message, 500, { requestId });
  const titles = new Map((leads ?? []).map((lead) => [lead.id, lead.title]));

  const recentes: JuncaoDeNegociosRecente[] = logs.map((item) => ({
    id: item.id,
    survivor_lead_id: item.survivor_lead_id,
    absorbed_lead_id: item.absorbed_lead_id,
    survivor_title: titles.get(item.survivor_lead_id) ?? "Negócio mantido",
    absorbed_title:
      typeof item.absorbed_snapshot?.title === "string"
        ? item.absorbed_snapshot.title
        : "Negócio absorvido",
    merged_at: item.merged_at,
    merged_by_user_id: item.merged_by_user_id,
  }));

  return ok(recentes, { requestId });
}
