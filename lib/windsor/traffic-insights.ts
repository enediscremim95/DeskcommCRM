export type TrafficLeadStatus = "open" | "won" | "lost";

export interface TrafficLeadRow {
  id?: string;
  status: string;
  stage_id: string;
  pipeline_id?: string;
  lost_reason: string | null;
  created_at?: string;
  closed_at?: string | null;
  value_cents?: number | null;
  currency?: string | null;
  source?: string | null;
  source_metadata?: unknown;
}

export interface TrafficStageRow {
  id: string;
  name: string;
  position: number | string;
  pipeline_id?: string;
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

export interface TrafficStageConversion {
  name: string;
  volume: number;
  from_previous: number | null;
  from_top: number | null;
  previous_volume: number | null;
  variation: number | null;
  is_won: boolean;
}

export interface TrafficSalesPoint {
  period: string;
  count: number;
  accumulated: number;
}

export interface TrafficSalesValue {
  currency: string;
  total_cents: number;
  average_cents: number;
  sales: number;
}

export interface TrafficRichCrmInsights extends TrafficLeadSituation {
  stage_conversion: TrafficStageConversion[];
  leads_timeline: Array<{ period: string; count: number }>;
  sales_timeline: TrafficSalesPoint[];
  sales_values: TrafficSalesValue[];
  leads_by_origin: { meta_ads: number | null; google_ads: number | null };
  won_by_origin: { meta_ads: number | null; google_ads: number | null };
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

function inWindow(value: string | null | undefined, from: string, to: string): boolean {
  if (!value) return false;
  const day = value.slice(0, 10);
  return day >= from && day <= to;
}

function monthOf(value: string): string {
  return value.slice(0, 7);
}

function originOf(lead: TrafficLeadRow): "meta_ads" | "google_ads" | null {
  const metadata =
    lead.source_metadata && typeof lead.source_metadata === "object"
      ? (lead.source_metadata as Record<string, unknown>)
      : {};
  const raw = [
    lead.source,
    metadata.utm_source,
    metadata.source,
    metadata.platform,
    metadata.ad_platform,
    metadata.origin,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  if (/facebook|instagram|meta/.test(raw)) return "meta_ads";
  if (/google|adwords/.test(raw)) return "google_ads";
  return null;
}

function stageVolumes(leads: TrafficLeadRow[], stages: TrafficStageRow[]) {
  const stageById = new Map(stages.map((stage) => [stage.id, stage]));
  const visibleStages = stages
    .filter((stage) => !stage.is_lost)
    .sort((a, b) => Number(a.position) - Number(b.position) || a.name.localeCompare(b.name));
  return visibleStages.map((stage) => {
    const volume = leads.filter((lead) => {
      if (stage.is_won) return lead.status === "won";
      const current = stageById.get(lead.stage_id);
      if (!current || current.is_lost || current.pipeline_id !== stage.pipeline_id) return false;
      return Number(current.position) >= Number(stage.position);
    }).length;
    return { name: stage.name, volume, is_won: stage.is_won };
  });
}

/** Agrega somente a coorte que entrou na janela selecionada. */
export function buildTrafficRichCrmInsights(args: {
  leads: TrafficLeadRow[];
  previousLeads?: TrafficLeadRow[];
  stages: TrafficStageRow[];
  window: { from: string; to: string };
}): TrafficRichCrmInsights {
  const leads = args.leads.filter((lead) =>
    inWindow(lead.created_at, args.window.from, args.window.to),
  );
  const base = buildTrafficLeadSituation(leads, args.stages);
  const current = stageVolumes(leads, args.stages);
  const previous = stageVolumes(args.previousLeads ?? [], args.stages);
  const previousByName = new Map(previous.map((stage) => [stage.name, stage.volume]));
  const top = current[0]?.volume ?? 0;
  const stageConversion = current.map((stage, index) => {
    const priorStage = index > 0 ? current[index - 1] : null;
    const previousVolume = previousByName.get(stage.name) ?? null;
    return {
      name: stage.name,
      volume: stage.volume,
      from_previous:
        priorStage && priorStage.volume > 0 ? (stage.volume / priorStage.volume) * 100 : null,
      from_top: top > 0 ? (stage.volume / top) * 100 : null,
      previous_volume: previousVolume,
      variation:
        previousVolume && previousVolume > 0
          ? ((stage.volume - previousVolume) / previousVolume) * 100
          : null,
      is_won: stage.is_won,
    };
  });

  const closed = leads.filter(
    (lead) => lead.status === "won" && inWindow(lead.closed_at, args.window.from, args.window.to),
  );
  const byMonth = new Map<string, number>();
  const leadsByMonth = new Map<string, number>();
  for (const lead of leads) {
    const month = monthOf(lead.created_at as string);
    leadsByMonth.set(month, (leadsByMonth.get(month) ?? 0) + 1);
  }
  for (const lead of closed) {
    const month = monthOf(lead.closed_at as string);
    byMonth.set(month, (byMonth.get(month) ?? 0) + 1);
  }
  let accumulated = 0;
  const salesTimeline = [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, count]) => {
      accumulated += count;
      return { period, count, accumulated };
    });

  const values = new Map<string, { total: number; sales: number }>();
  for (const lead of closed) {
    if (lead.value_cents == null || !lead.currency) continue;
    const currentValue = values.get(lead.currency) ?? { total: 0, sales: 0 };
    currentValue.total += lead.value_cents;
    currentValue.sales += 1;
    values.set(lead.currency, currentValue);
  }

  const originCounts = { meta_ads: 0, google_ads: 0 };
  const wonOriginCounts = { meta_ads: 0, google_ads: 0 };
  const knownOrigin = { meta_ads: false, google_ads: false };
  for (const lead of leads) {
    const origin = originOf(lead);
    if (!origin) continue;
    knownOrigin[origin] = true;
    originCounts[origin] += 1;
    if (lead.status === "won") wonOriginCounts[origin] += 1;
  }

  return {
    ...base,
    stage_conversion: stageConversion,
    leads_timeline: [...leadsByMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, count]) => ({ period, count })),
    sales_timeline: salesTimeline,
    sales_values: [...values.entries()].map(([currency, value]) => ({
      currency,
      total_cents: value.total,
      average_cents: Math.round(value.total / value.sales),
      sales: value.sales,
    })),
    leads_by_origin: {
      meta_ads: knownOrigin.meta_ads ? originCounts.meta_ads : null,
      google_ads: knownOrigin.google_ads ? originCounts.google_ads : null,
    },
    won_by_origin: {
      meta_ads: knownOrigin.meta_ads ? wonOriginCounts.meta_ads : null,
      google_ads: knownOrigin.google_ads ? wonOriginCounts.google_ads : null,
    },
  };
}

export interface FunnelReadingStage {
  label: string;
  value: number;
}

export function buildFunnelReadings(
  current: FunnelReadingStage[],
  previous: FunnelReadingStage[],
): Array<{ kind: "lowest" | "drop" | "improvement"; from: string; to: string; value: number }> {
  if (current.length < 2) return [];
  const rates = current.slice(1).map((stage, index) => {
    const before = current[index];
    if (!before) return { from: "", to: stage.label, value: null };
    return {
      from: before.label,
      to: stage.label,
      value: before.value > 0 ? (stage.value / before.value) * 100 : null,
    };
  });
  const valid = rates.filter((rate): rate is typeof rate & { value: number } => rate.value != null);
  if (valid.length === 0) return [];
  const output: Array<{
    kind: "lowest" | "drop" | "improvement";
    from: string;
    to: string;
    value: number;
  }> = [{ kind: "lowest", ...valid.reduce((a, b) => (b.value < a.value ? b : a)) }];
  if (previous.length !== current.length) return output;
  const deltas = valid
    .map((rate, index) => {
      const before = previous[index];
      const after = previous[index + 1];
      if (!before || !after || before.value <= 0) return null;
      return { ...rate, value: rate.value - (after.value / before.value) * 100 };
    })
    .filter((item): item is NonNullable<typeof item> => item != null && item.value !== 0);
  const drop = deltas.filter((item) => item.value < 0).sort((a, b) => a.value - b.value)[0];
  const improvement = deltas.filter((item) => item.value > 0).sort((a, b) => b.value - a.value)[0];
  if (drop) output.push({ kind: "drop", ...drop });
  if (improvement) output.push({ kind: "improvement", ...improvement });
  return output.slice(0, 3);
}
