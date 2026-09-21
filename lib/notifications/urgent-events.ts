import type { SupabaseClient } from "@supabase/supabase-js";

export interface OverdueTaskEnqueueResult {
  scanned: number;
  enqueued: number;
}

/**
 * O relógio não produz UPDATE quando uma tarefa cruza o vencimento. O watcher
 * consulta as tarefas abertas e a chave única do event_log transforma cada
 * task em uma única situação, mesmo rodando a cada 15 minutos.
 */
export async function enqueueOverdueLeadTaskEvents(
  admin: SupabaseClient,
  organizationId: string,
  now: Date = new Date(),
): Promise<OverdueTaskEnqueueResult> {
  const { data, error } = await admin
    .from("crm_tasks")
    .select("id,lead_id")
    .eq("organization_id", organizationId)
    .in("status", ["pending", "in_progress"])
    .not("lead_id", "is", null)
    .lte("due_date", now.toISOString())
    .limit(500);
  if (error) throw new Error(`email_urgent_tasks_scan_failed: ${error.message}`);

  let enqueued = 0;
  for (const task of data ?? []) {
    if (!task.lead_id) continue;
    const { error: insertError } = await admin.from("event_log").insert({
      organization_id: organizationId,
      event_type: "lead.action_required",
      entity_kind: "crm_lead",
      entity_id: task.lead_id,
      payload: { reason: "task_overdue", task_id: task.id },
      metadata: { email_dedupe_key: `task-overdue:${task.id}` },
    });
    if (!insertError) {
      enqueued += 1;
      continue;
    }
    // 23505 = a mesma situação já foi enfileirada numa passada anterior.
    if (insertError.code !== "23505") {
      throw new Error(`email_urgent_task_enqueue_failed: ${insertError.message}`);
    }
  }
  return { scanned: data?.length ?? 0, enqueued };
}
