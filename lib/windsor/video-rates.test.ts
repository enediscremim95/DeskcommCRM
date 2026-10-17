import { describe, expect, it } from "vitest";

import { calculateVideoRates } from "./video-rates";

describe("Hook rate e Hold rate por anúncio", () => {
  it("usa reproduções de 3 segundos no Hook e reproduções de 75% no Hold", () => {
    const rates = calculateVideoRates([
      { impressions: 1_000, video_views: 550, video_p75: 90 },
    ]);

    expect(rates.hook_rate).toBeCloseTo(55, 10);
    expect(rates.hold_rate).toBe(9);
  });

  it("trata anúncio sem reproduções como imagem, não como vídeo com zero", () => {
    expect(
      calculateVideoRates([{ impressions: 1_000, video_views: 0, video_p75: 0 }]),
    ).toEqual({ hook_rate: null, hold_rate: null });
  });

  it("mantém Hold zero quando houve reprodução de vídeo, mas nenhuma chegou a 75%", () => {
    expect(
      calculateVideoRates([{ impressions: 1_000, video_views: 500, video_p75: 0 }]),
    ).toEqual({ hook_rate: 50, hold_rate: 0 });
  });

  it("no total soma apenas as impressões dos anúncios com vídeo", () => {
    const rates = calculateVideoRates([
      { impressions: 1_000, video_views: 500, video_p75: 100 },
      { impressions: 4_000, video_views: 0, video_p75: 0 },
      { impressions: 500, video_views: 250, video_p75: 25 },
    ]);

    expect(rates.hook_rate).toBe(50);
    expect(rates.hold_rate).toBeCloseTo(8.3333, 4);
  });

  it("não divide por zero", () => {
    expect(calculateVideoRates([{ impressions: 0, video_views: 1, video_p75: 0 }])).toEqual({
      hook_rate: null,
      hold_rate: null,
    });
    expect(calculateVideoRates([])).toEqual({ hook_rate: null, hold_rate: null });
  });
});
