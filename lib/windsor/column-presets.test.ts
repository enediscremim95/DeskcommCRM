import { describe, expect, it } from "vitest";

import {
  columnsCanBePersisted,
  serializeTrafficColumnPresets,
  trafficColumnPresetColumnsSchema,
} from "./column-presets";
import { campaignMetricColumnsForPlatform, defaultCampaignColumns } from "./types";

describe("predefinições de colunas do Relatório", () => {
  it("preserva a ordem e identifica o padrão", () => {
    expect(
      serializeTrafficColumnPresets(
        [
          {
            id: "preset-1",
            name: "KPI",
            metric_columns: ["leads", "spend", "ctr"],
            platform: "meta_ads",
          },
        ],
        "preset-1",
      ),
    ).toEqual([
      {
        id: "preset-1",
        name: "KPI",
        columns: ["leads", "spend", "ctr"],
        platform: "meta_ads",
        is_default: true,
      },
    ]);
  });

  it("não entrega ao browser uma linha legada inválida", () => {
    expect(
      serializeTrafficColumnPresets(
        [
          {
            id: "preset-1",
            name: "Inválida",
            metric_columns: ["spend", "desconhecida"],
            platform: "meta_ads",
          },
        ],
        null,
      ),
    ).toEqual([]);
  });

  it("não entrega métrica exclusiva do Meta em predefinição do Google", () => {
    expect(
      serializeTrafficColumnPresets(
        [
          {
            id: "preset-1",
            name: "Mensagens",
            metric_columns: ["spend", "messaging_conversations"],
            platform: "google_ads",
          },
        ],
        null,
      ),
    ).toEqual([]);
  });

  it("oferece ao Google só métricas calculadas e mantém resultado no padrão de mensagens", () => {
    expect(campaignMetricColumnsForPlatform("google_ads")).not.toEqual(
      expect.arrayContaining(["reach", "hook_rate", "hold_rate", "messaging_conversations"]),
    );
    expect(defaultCampaignColumns("messages", "google_ads")).toEqual(
      expect.arrayContaining(["leads", "cost_per_lead"]),
    );
  });

  it("oferece Hook rate e Hold rate só ao Meta e os coloca após CTR no padrão", () => {
    const available = campaignMetricColumnsForPlatform("meta_ads");
    const defaults = defaultCampaignColumns("leads", "meta_ads");

    expect(available).toEqual(expect.arrayContaining(["hook_rate", "hold_rate"]));
    expect(defaults.slice(defaults.indexOf("ctr"), defaults.indexOf("ctr") + 3)).toEqual([
      "ctr",
      "hook_rate",
      "hold_rate",
    ]);
    expect(columnsCanBePersisted(["spend", "hook_rate"])).toBe(false);
    expect(trafficColumnPresetColumnsSchema.safeParse(["spend", "hook_rate"]).success).toBe(
      false,
    );
  });
});
