import { describe, expect, it } from "vitest";

import { serializeTrafficColumnPresets } from "./column-presets";
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
      expect.arrayContaining(["reach", "messaging_conversations"]),
    );
    expect(defaultCampaignColumns("messages", "google_ads")).toEqual(
      expect.arrayContaining(["leads", "cost_per_lead"]),
    );
  });
});
