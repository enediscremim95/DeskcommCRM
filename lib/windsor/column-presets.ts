import { z } from "zod";

import {
  AD_PLATFORMS,
  CAMPAIGN_METRIC_COLUMNS,
  campaignMetricColumnsForPlatform,
  type AdPlatform,
  type CampaignMetricColumn,
} from "@/lib/windsor/types";

export const trafficColumnPresetNameSchema = z.string().trim().min(1).max(80);
export const trafficColumnPresetPlatformSchema = z.enum(AD_PLATFORMS);

export const trafficColumnPresetColumnsSchema = z
  .array(z.enum(CAMPAIGN_METRIC_COLUMNS))
  .min(1)
  .max(CAMPAIGN_METRIC_COLUMNS.length)
  .refine((columns) => new Set(columns).size === columns.length, "Colunas duplicadas.");

export interface TrafficColumnPreset {
  id: string;
  name: string;
  columns: CampaignMetricColumn[];
  platform: AdPlatform;
  is_default: boolean;
}

interface TrafficColumnPresetRow {
  id: string;
  name: string;
  metric_columns: unknown;
  platform: unknown;
}

export function columnsBelongToPlatform(
  platform: AdPlatform,
  columns: CampaignMetricColumn[],
): boolean {
  const allowed = new Set(campaignMetricColumnsForPlatform(platform));
  return columns.every((column) => allowed.has(column));
}

export function serializeTrafficColumnPresets(
  rows: TrafficColumnPresetRow[] | null,
  defaultPresetId: string | null,
): TrafficColumnPreset[] {
  return (rows ?? []).flatMap((row) => {
    const parsed = trafficColumnPresetColumnsSchema.safeParse(row.metric_columns);
    const parsedPlatform = trafficColumnPresetPlatformSchema.safeParse(row.platform);
    if (
      !parsed.success ||
      !parsedPlatform.success ||
      !columnsBelongToPlatform(parsedPlatform.data, parsed.data)
    ) {
      return [];
    }
    return [
      {
        id: row.id,
        name: row.name,
        columns: parsed.data,
        platform: parsedPlatform.data,
        is_default: row.id === defaultPresetId,
      },
    ];
  });
}
