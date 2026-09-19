import { z } from "zod";

import { CAMPAIGN_METRIC_COLUMNS, type CampaignMetricColumn } from "@/lib/windsor/types";

export const trafficColumnPresetNameSchema = z.string().trim().min(1).max(80);

export const trafficColumnPresetColumnsSchema = z
  .array(z.enum(CAMPAIGN_METRIC_COLUMNS))
  .min(1)
  .max(CAMPAIGN_METRIC_COLUMNS.length)
  .refine((columns) => new Set(columns).size === columns.length, "Colunas duplicadas.");

export interface TrafficColumnPreset {
  id: string;
  name: string;
  columns: CampaignMetricColumn[];
  is_default: boolean;
}

interface TrafficColumnPresetRow {
  id: string;
  name: string;
  metric_columns: unknown;
}

export function serializeTrafficColumnPresets(
  rows: TrafficColumnPresetRow[] | null,
  defaultPresetId: string | null,
): TrafficColumnPreset[] {
  return (rows ?? []).flatMap((row) => {
    const parsed = trafficColumnPresetColumnsSchema.safeParse(row.metric_columns);
    if (!parsed.success) return [];
    return [
      {
        id: row.id,
        name: row.name,
        columns: parsed.data,
        is_default: row.id === defaultPresetId,
      },
    ];
  });
}
