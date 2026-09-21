export type TrafficLeadStatus = "open" | "won" | "lost";

export interface TrafficLeadRow {
  status: string;
  stage_id: string;
  lost_reason: string | null;
}

export interface TrafficStageRow {
  id: string;
  name: string;
  position: number | string;
  is_won: boolean;
  is_lost: boolean;
}

export interface TrafficLeadSituation {
  leads_entered: number;
  in_service: number;
  closed_won: number;
  closed_lost: number;
  stages: Array<{ name: string; count: number }>;
  loss_reasons: Array<{ reason: string; count: number }>;
}

function compareCountThenName(
  a: { count: number; name: string },
  b: { count: number; name: string },
): number {
  return b.count - a.count || a.name.localeCompare(b.name, "pt-BR");
}

export function buildTrafficLeadSituation(
  leads: TrafficLeadRow[],
  stages: TrafficStageRow[],
): TrafficLeadSituation {
  const stageById = new Map(stages.map((stage) => [stage.id, stage]));
  const stageCounts = new Map<string, { name: string; position: number; count: number }>();
  const lossReasonCounts = new Map<string, number>();
  let inService = 0;
  let closedWon = 0;
  let closedLost = 0;

  for (const lead of leads) {
    if (lead.status === "open") inService += 1;
    else if (lead.status === "won") closedWon += 1;
    else if (lead.status === "lost") closedLost += 1;

    const stage = stageById.get(lead.stage_id);
    if (stage) {
      const current = stageCounts.get(stage.id);
      if (current) current.count += 1;
      else {
        const parsedPosition = Number(stage.position);
        stageCounts.set(stage.id, {
          name: stage.name,
          position: Number.isFinite(parsedPosition) ? parsedPosition : Number.MAX_SAFE_INTEGER,
          count: 1,
        });
      }
    }

    if (lead.status === "lost") {
      const reason = lead.lost_reason?.trim();
      if (reason) lossReasonCounts.set(reason, (lossReasonCounts.get(reason) ?? 0) + 1);
    }
  }

  return {
    leads_entered: leads.length,
    in_service: inService,
    closed_won: closedWon,
    closed_lost: closedLost,
    stages: [...stageCounts.values()]
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, "pt-BR"))
      .map(({ name, count }) => ({ name, count })),
    loss_reasons: [...lossReasonCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort(compareCountThenName)
      .map(({ name: reason, count }) => ({ reason, count })),
  };
}
