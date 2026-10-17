export interface VideoRateRow {
  impressions: number;
  video_views: number;
  video_p75: number;
}

export interface VideoRates {
  hook_rate: number | null;
  hold_rate: number | null;
}

/**
 * Hook = reproduções de 3 segundos ÷ impressões; Hold = reproduções de 75% ÷ impressões.
 * No agregado, imagens ficam fora do denominador para não diluir a retenção dos vídeos.
 */
export function calculateVideoRates(rows: readonly VideoRateRow[]): VideoRates {
  const videos = rows.filter((row) => row.video_views > 0 || row.video_p75 > 0);
  if (videos.length === 0) return { hook_rate: null, hold_rate: null };

  const impressions = videos.reduce((total, row) => total + row.impressions, 0);
  if (impressions <= 0) return { hook_rate: null, hold_rate: null };

  const videoViews = videos.reduce((total, row) => total + row.video_views, 0);
  const videoP75 = videos.reduce((total, row) => total + row.video_p75, 0);
  return {
    hook_rate: (videoViews / impressions) * 100,
    hold_rate: (videoP75 / impressions) * 100,
  };
}
